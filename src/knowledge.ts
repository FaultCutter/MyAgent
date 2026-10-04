import { createHash } from "node:crypto";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "@huggingface/transformers";
import { ChromaClient } from "chromadb";
import type { Collection, Metadata } from "chromadb";
import { config } from "./config.js";

const CHUNK_SIZE = 1_200;
const CHUNK_OVERLAP = 150;
const EMBEDDING_BATCH_SIZE = 16;

interface EmbeddingOutput {
  tolist(): unknown;
}

interface EmbeddingPipeline {
  (texts: string[], options: { pooling: "mean"; normalize: true }): Promise<EmbeddingOutput>;
}

export interface KnowledgeChunk {
  id: string;
  source: string;
  text: string;
}

export interface KnowledgeSearchResult extends KnowledgeChunk {
  distance: number | null;
}

export interface KnowledgeIndexResult {
  changed: boolean;
  documents: number;
  chunks: number;
  collection: string;
}

let cachedEmbeddingPipeline: EmbeddingPipeline | null = null;

// 读取当前知识库使用的本地模型目录。
function modelPath(): string {
  return config.chroma.modelPath;
}

// 读取当前知识文档目录。
function knowledgePath(): string {
  return config.knowledgePath;
}

// 读取 Chroma collection 名称。
function collectionName(): string {
  return config.chroma.collection;
}

// 创建连接本机 Chroma Server 的客户端。
function createChromaClient(): ChromaClient {
  const { host, port } = config.chroma;

  return new ChromaClient({
    host,
    port,
    ssl: false
  });
}

// 确认本地模型目录包含推理和分词所需文件。
async function assertLocalModel(): Promise<string> {
  const directory = modelPath();
  const requiredFiles = ["model.onnx", "config.json", "tokenizer.json"];

  try {
    await Promise.all(requiredFiles.map((file) => access(path.join(directory, file))));
  } catch {
    throw new Error(
      `Local embedding model is incomplete at ${directory}. ` +
        "Set CHROMA_MODEL_PATH to the extracted all-MiniLM-L6-v2 ONNX directory."
    );
  }

  return directory;
}

// 延迟加载本地 ONNX 模型，并明确禁止从网络下载模型。
async function loadEmbeddingPipeline(): Promise<EmbeddingPipeline> {
  if (cachedEmbeddingPipeline) return cachedEmbeddingPipeline;

  const directory = await assertLocalModel();
  const loaded = await pipeline("feature-extraction", directory, {
    local_files_only: true,
    subfolder: "",
    dtype: "fp32"
  });

  cachedEmbeddingPipeline = loaded as unknown as EmbeddingPipeline;
  return cachedEmbeddingPipeline;
}

// 使用本地 MiniLM 模型生成归一化的 384 维向量。
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const embed = await loadEmbeddingPipeline();
  const output = await embed(texts, { pooling: "mean", normalize: true });
  const vectors = output.tolist();

  if (!Array.isArray(vectors) || vectors.some((vector) => !Array.isArray(vector))) {
    throw new Error("The local embedding model returned an unexpected result.");
  }

  return vectors as number[][];
}

// 把一段过长文本按固定长度和重叠区间拆开。
function splitLongText(text: string, limit: number, overlap: number): string[] {
  const parts: string[] = [];
  const step = Math.max(1, limit - overlap);

  for (let start = 0; start < text.length; start += step) {
    parts.push(text.slice(start, start + limit));
    if (start + limit >= text.length) break;
  }

  return parts;
}

// 将单个知识文档按段落切成稳定编号的检索片段。
export function splitKnowledgeText(
  source: string,
  text: string,
  limit = CHUNK_SIZE,
  overlap = CHUNK_OVERLAP
): KnowledgeChunk[] {
  if (limit <= 0 || overlap < 0 || overlap >= limit) {
    throw new Error("Chunk limit and overlap are invalid.");
  }

  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const paragraphs = normalized.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const texts: string[] = [];
  let current = "";

  // 把当前累积内容写入结果并清空缓冲区。
  function flush(): void {
    if (current) texts.push(current);
    current = "";
  }

  for (const paragraph of paragraphs) {
    if (paragraph.length > limit) {
      flush();
      texts.push(...splitLongText(paragraph, limit, overlap));
      continue;
    }

    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > limit) flush();
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }

  flush();
  return texts.map((chunk, index) => ({
    id: `${source}#${String(index + 1).padStart(4, "0")}`,
    source,
    text: chunk
  }));
}

// 递归收集知识库中的 Markdown 和纯文本文件。
async function collectKnowledgeFiles(directory: string): Promise<string[]> {
  const files: string[] = [];

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;

    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectKnowledgeFiles(absolutePath)));
      continue;
    }

    if ([".md", ".txt"].includes(path.extname(entry.name).toLowerCase())) {
      files.push(absolutePath);
    }
  }

  return files;
}

// 加载知识目录并把全部文档转换为检索片段。
export async function loadKnowledgeChunks(directory = knowledgePath()): Promise<KnowledgeChunk[]> {
  let files: string[];

  try {
    files = await collectKnowledgeFiles(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Knowledge directory does not exist: ${directory}`);
    }
    throw error;
  }

  const chunks: KnowledgeChunk[] = [];
  for (const file of files.sort()) {
    const source = path.relative(directory, file).split(path.sep).join("/");
    chunks.push(...splitKnowledgeText(source, await readFile(file, "utf8")));
  }

  return chunks;
}

// 计算知识片段集合的稳定哈希以检测索引是否过期。
export function hashKnowledgeChunks(chunks: KnowledgeChunk[]): string {
  return createHash("sha256").update(JSON.stringify(chunks)).digest("hex");
}

// 连接 Chroma Server，并把连接错误转换为可操作提示。
export async function connectChroma(): Promise<ChromaClient> {
  const client = createChromaClient();

  try {
    await client.heartbeat();
  } catch {
    const { host, port } = config.chroma;
    throw new Error(
      `Cannot connect to Chroma at http://${host}:${port}. Run npm run knowledge:server first.`
    );
  }

  return client;
}

// 打开知识集合；首次使用时创建一个余弦距离集合。
async function openCollection(): Promise<Collection> {
  const client = await connectChroma();
  return client.getOrCreateCollection({
    name: collectionName(),
    embeddingFunction: null,
    configuration: { hnsw: { space: "cosine" } }
  });
}

// 检查语料哈希，并在必要时同步知识索引后返回可查询的集合。
async function ensureKnowledgeIndex(): Promise<{
  collection: Collection;
  result: KnowledgeIndexResult;
}> {
  const chunks = await loadKnowledgeChunks();
  if (chunks.length === 0) {
    throw new Error("No .md or .txt knowledge documents were found.");
  }

  const collection = await openCollection();
  const corpusHash = hashKnowledgeChunks(chunks);
  const currentHash = collection.metadata?.corpus_sha256;
  const currentCount = await collection.count();

  if (currentHash === corpusHash && currentCount === chunks.length) {
    return {
      collection,
      result: {
        changed: false,
        documents: new Set(chunks.map((chunk) => chunk.source)).size,
        chunks: chunks.length,
        collection: collectionName()
      }
    };
  }

  const activeIds = new Set(chunks.map((chunk) => chunk.id));
  const existing = await collection.get({ include: [] });
  const staleIds = existing.ids.filter((id) => !activeIds.has(id));

  for (let start = 0; start < chunks.length; start += EMBEDDING_BATCH_SIZE) {
    const batch = chunks.slice(start, start + EMBEDDING_BATCH_SIZE);
    const embeddings = await embedTexts(batch.map((chunk) => chunk.text));
    await collection.upsert({
      ids: batch.map((chunk) => chunk.id),
      documents: batch.map((chunk) => chunk.text),
      metadatas: batch.map((chunk) => ({ source: chunk.source, chunk_id: chunk.id })),
      embeddings
    });
  }

  if (staleIds.length > 0) await collection.delete({ ids: staleIds });
  await collection.modify({ metadata: { corpus_sha256: corpusHash } });

  return {
    collection,
    result: {
      changed: true,
      documents: new Set(chunks.map((chunk) => chunk.source)).size,
      chunks: chunks.length,
      collection: collectionName()
    }
  };
}

// 手动建立或刷新知识索引，供 CLI 排错使用。
export async function indexKnowledgeBase(): Promise<KnowledgeIndexResult> {
  return (await ensureKnowledgeIndex()).result;
}

// 在本地 Chroma 索引中执行一次语义检索。
export async function searchKnowledge(query: string, topK = 5): Promise<KnowledgeSearchResult[]> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) throw new Error("Knowledge query cannot be empty.");

  const { collection } = await ensureKnowledgeIndex();

  const count = await collection.count();
  if (count === 0) return [];

  const [queryEmbedding] = await embedTexts([normalizedQuery]);
  if (!queryEmbedding) throw new Error("The local embedding model returned no query vector.");

  const result = await collection.query<Metadata>({
    queryEmbeddings: [queryEmbedding],
    nResults: Math.min(Math.max(1, topK), Math.min(10, count)),
    include: ["documents", "metadatas", "distances"]
  });

  const ids = result.ids[0] ?? [];
  const documents = result.documents?.[0] ?? [];
  const metadatas = result.metadatas?.[0] ?? [];
  const distances = result.distances?.[0] ?? [];

  return ids.map((id, index) => {
    const metadata = metadatas[index];
    return {
      id,
      source: typeof metadata?.source === "string" ? metadata.source : id.split("#")[0] ?? id,
      text: documents[index] ?? "",
      distance: distances[index] ?? null
    };
  });
}
