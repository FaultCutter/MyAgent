import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { Collection, Metadata } from "chromadb";
import { config } from "./config.js";
import { connectChroma, embedTexts, splitKnowledgeText } from "./knowledge.js";
import { parsePdf } from "./pdf.js";
import type { ParsedPdf, PdfPage } from "./pdf.js";

const ARXIV_API_URL = "https://export.arxiv.org/api/query";
const MAX_RESULTS = 10;
const REQUEST_INTERVAL_MS = 3_000;
const EMBEDDING_BATCH_SIZE = 16;
let lastRequestAt = 0;

export interface ArxivPaper {
  id: string;
  arxivId: string;
  title: string;
  summary: string;
  authors: string[];
  categories: string[];
  published: string;
  updated: string;
  abstractUrl: string;
  pdfUrl: string;
}

// 解码 Atom XML 中常见的命名实体与数字实体。
function decodeXml(value: string): string {
  const namedEntities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    quot: '"'
  };

  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    }
    return namedEntities[entity.toLowerCase()] ?? match;
  });
}

// 读取 XML 片段中的首个指定标签并规范化空白。
function readTag(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  const content = match?.[1];
  return content
    ? decodeXml(content.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()
    : "";
}

// 从 XML 标签属性文本中读取指定属性。
function readAttribute(attributes: string, name: string): string {
  const match = attributes.match(new RegExp(`${name}=["']([^"']*)["']`, "i"));
  return match?.[1] ? decodeXml(match[1]) : "";
}

// 将 arXiv 输入规范化为不含 URL 前缀的论文编号。
export function normalizeArxivId(value: string): string {
  const normalized = value
    .trim()
    .replace(/^https?:\/\/(?:export\.)?arxiv\.org\/(?:abs|pdf)\//i, "")
    .replace(/\.pdf$/i, "");

  if (!/^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z-]+)?\/\d{7})(?:v\d+)?$/i.test(normalized)) {
    throw new Error(`Invalid arXiv ID: ${value}`);
  }

  return normalized;
}

// 从 arXiv Atom Feed 中解析论文元数据。
export function parseArxivFeed(xml: string): ArxivPaper[] {
  const entries = [...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)];

  return entries.map((entry) => {
    const body = entry[1] ?? "";
    const abstractUrl = readTag(body, "id").replace(/^http:/i, "https:");
    const idFromUrl = abstractUrl.match(/\/abs\/([^?#]+)/i)?.[1] ?? "";
    const id = normalizeArxivId(idFromUrl);
    const arxivId = id.replace(/v\d+$/i, "");
    const links = [...body.matchAll(/<link\b([^>]*)\/?\s*>/gi)].map(
      (match) => match[1] ?? ""
    );
    const pdfAttributes = links.find(
      (attributes) =>
        readAttribute(attributes, "type") === "application/pdf" ||
        readAttribute(attributes, "title").toLowerCase() === "pdf"
    );
    const pdfUrl = pdfAttributes
      ? readAttribute(pdfAttributes, "href").replace(/^http:/i, "https:")
      : `https://arxiv.org/pdf/${id}`;
    const authors = [...body.matchAll(/<author\b[^>]*>([\s\S]*?)<\/author>/gi)]
      .map((match) => readTag(match[1] ?? "", "name"))
      .filter(Boolean);
    const categories = [...body.matchAll(/<category\b([^>]*)\/?\s*>/gi)]
      .map((match) => readAttribute(match[1] ?? "", "term"))
      .filter(Boolean);

    return {
      id,
      arxivId,
      title: readTag(body, "title"),
      summary: readTag(body, "summary"),
      authors,
      categories,
      published: readTag(body, "published"),
      updated: readTag(body, "updated"),
      abstractUrl,
      pdfUrl
    };
  });
}

// 请求一次 arXiv API 并解析 Atom Feed。
async function requestArxiv(
  parameters: URLSearchParams,
  fetchImpl: typeof fetch = fetch
): Promise<ArxivPaper[]> {
  const waitMilliseconds = Math.max(0, REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt));
  if (waitMilliseconds > 0) await delay(waitMilliseconds);
  lastRequestAt = Date.now();

  const response = await fetchImpl(`${ARXIV_API_URL}?${parameters.toString()}`, {
    headers: { "User-Agent": "myAgent/0.1 (personal learning project)" },
    signal: AbortSignal.timeout(20_000)
  });

  if (!response.ok) {
    throw new Error(`arXiv API request failed: HTTP ${response.status}`);
  }

  return parseArxivFeed(await response.text());
}

// 按关键词搜索 arXiv 论文，单次最多返回十条。
export async function searchArxiv(
  query: string,
  maxResults = 5,
  fetchImpl: typeof fetch = fetch
): Promise<ArxivPaper[]> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) throw new Error("arXiv query cannot be empty.");

  const resultCount = Math.min(Math.max(1, Math.trunc(maxResults)), MAX_RESULTS);
  return requestArxiv(
    new URLSearchParams({
      search_query: `all:${normalizedQuery}`,
      start: "0",
      max_results: String(resultCount),
      sortBy: "relevance",
      sortOrder: "descending"
    }),
    fetchImpl
  );
}

// 按 arXiv ID 获取单篇论文的最新版元数据。
export async function getArxivPaper(
  arxivId: string,
  fetchImpl: typeof fetch = fetch
): Promise<ArxivPaper> {
  const normalizedId = normalizeArxivId(arxivId);
  const papers = await requestArxiv(
    new URLSearchParams({ id_list: normalizedId, max_results: "1" }),
    fetchImpl
  );
  const paper = papers[0];
  if (!paper) throw new Error(`arXiv paper not found: ${normalizedId}`);
  return paper;
}

export interface PaperChunk {
  id: string;
  paperId: string;
  arxivId: string;
  title: string;
  page: number;
  chunkIndex: number;
  text: string;
  abstractUrl: string;
}

export interface PaperImportResult {
  cached: boolean;
  paper: ArxivPaper;
  pageCount: number;
  chunks: number;
  directory: string;
  collection: string;
}

export interface PaperSearchResult extends PaperChunk {
  distance: number | null;
}

interface PaperManifest {
  paper: ArxivPaper;
  importedAt: string;
  pageCount: number;
  chunks: number;
}

// 把 arXiv 编号转换成可安全用于 Windows 目录名的名称。
function safePaperName(arxivId: string): string {
  return arxivId.replace(/[^a-z0-9._-]+/gi, "_");
}

// 判断指定本地文件是否存在。
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

// 打开独立的论文 Chroma collection，避免刷新普通知识库时误删论文。
async function openPaperCollection(create: boolean): Promise<Collection> {
  const client = await connectChroma();
  const name = config.paper.collection;

  if (create) {
    return client.getOrCreateCollection({
      name,
      embeddingFunction: null,
      configuration: { hnsw: { space: "cosine" } }
    });
  }

  try {
    return await client.getCollection({ name });
  } catch {
    throw new Error("Paper index does not exist. Import a paper first.");
  }
}

// 按页切分论文，使每个检索结果都能回到明确页码。
export function chunkPaperPages(
  paper: ArxivPaper,
  pages: PdfPage[],
  limit = 1_200,
  overlap = 150
): PaperChunk[] {
  const prefix = safePaperName(paper.id);

  return pages.flatMap((page) =>
    splitKnowledgeText(`page-${page.pageNumber}`, page.text, limit, overlap).map(
      (chunk, index) => ({
        id: `${prefix}#p${String(page.pageNumber).padStart(4, "0")}-c${String(index + 1).padStart(4, "0")}`,
        paperId: paper.id,
        arxivId: paper.arxivId,
        title: paper.title,
        page: page.pageNumber,
        chunkIndex: index + 1,
        text: chunk.text,
        abstractUrl: paper.abstractUrl
      })
    )
  );
}

// 检查指定论文是否已经存在至少一个向量片段。
async function hasIndexedPaper(collection: Collection, paperId: string): Promise<boolean> {
  const result = await collection.get({
    where: { paper_id: paperId },
    limit: 1,
    include: []
  });
  return result.ids.length > 0;
}

// 将一篇论文的全部分页片段写入独立向量集合。
async function indexPaperChunks(collection: Collection, chunks: PaperChunk[]): Promise<void> {
  const firstChunk = chunks[0];
  if (!firstChunk) throw new Error("No searchable text was extracted from the PDF.");

  await collection.delete({ where: { paper_id: firstChunk.paperId } });

  for (let start = 0; start < chunks.length; start += EMBEDDING_BATCH_SIZE) {
    const batch = chunks.slice(start, start + EMBEDDING_BATCH_SIZE);
    const embeddings = await embedTexts(batch.map((chunk) => chunk.text));
    await collection.upsert({
      ids: batch.map((chunk) => chunk.id),
      documents: batch.map((chunk) => chunk.text),
      metadatas: batch.map((chunk) => ({
        paper_id: chunk.paperId,
        arxiv_id: chunk.arxivId,
        title: chunk.title,
        page: chunk.page,
        chunk_index: chunk.chunkIndex,
        abstract_url: chunk.abstractUrl
      })),
      embeddings
    });
  }
}

// 下载论文 PDF，并限制响应大小与文件类型。
async function downloadPaperPdf(
  paper: ArxivPaper,
  fetchImpl: typeof fetch = fetch
): Promise<Uint8Array> {
  const response = await fetchImpl(paper.pdfUrl, {
    headers: { "User-Agent": "myAgent/0.1 (personal learning project)" },
    signal: AbortSignal.timeout(60_000)
  });
  if (!response.ok) throw new Error(`PDF download failed: HTTP ${response.status}`);

  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > config.paper.maxPdfBytes) {
    throw new Error(`PDF is larger than the ${config.paper.maxPdfBytes} byte limit.`);
  }

  const data = new Uint8Array(await response.arrayBuffer());
  if (data.byteLength > config.paper.maxPdfBytes) {
    throw new Error(`PDF is larger than the ${config.paper.maxPdfBytes} byte limit.`);
  }
  if (new TextDecoder("ascii").decode(data.slice(0, 5)) !== "%PDF-") {
    throw new Error("The arXiv download did not return a PDF file.");
  }
  return data;
}

// 读取已经缓存的论文清单。
async function readManifest(filePath: string): Promise<PaperManifest | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as PaperManifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

// 下载、解析、分页切块并索引一篇 arXiv 论文。
export async function importArxivPaper(
  arxivId: string,
  fetchImpl: typeof fetch = fetch
): Promise<PaperImportResult> {
  const paper = await getArxivPaper(arxivId, fetchImpl);
  const directory = path.join(config.paper.dataPath, safePaperName(paper.id));
  const pdfPath = path.join(directory, "paper.pdf");
  const parsedPath = path.join(directory, "parsed.json");
  const manifestPath = path.join(directory, "metadata.json");
  await mkdir(directory, { recursive: true });

  const collection = await openPaperCollection(true);
  const manifest = await readManifest(manifestPath);
  if (manifest && (await hasIndexedPaper(collection, paper.id))) {
    return {
      cached: true,
      paper: manifest.paper,
      pageCount: manifest.pageCount,
      chunks: manifest.chunks,
      directory,
      collection: config.paper.collection
    };
  }

  let pdfData: Uint8Array;
  if (await fileExists(pdfPath)) {
    pdfData = new Uint8Array(await readFile(pdfPath));
  } else {
    pdfData = await downloadPaperPdf(paper, fetchImpl);
    await writeFile(pdfPath, pdfData);
  }

  let parsed: ParsedPdf;
  if (await fileExists(parsedPath)) {
    parsed = JSON.parse(await readFile(parsedPath, "utf8")) as ParsedPdf;
  } else {
    parsed = await parsePdf(pdfData);
    await writeFile(parsedPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  }

  const chunks = chunkPaperPages(paper, parsed.pages);
  await indexPaperChunks(collection, chunks);

  const nextManifest: PaperManifest = {
    paper,
    importedAt: new Date().toISOString(),
    pageCount: parsed.pageCount,
    chunks: chunks.length
  };
  await writeFile(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, "utf8");

  return {
    cached: false,
    paper,
    pageCount: parsed.pageCount,
    chunks: chunks.length,
    directory,
    collection: config.paper.collection
  };
}

// 在已导入论文中执行语义检索，并返回可直接引用的页码信息。
export async function searchPapers(
  query: string,
  options: { arxivId?: string; topK?: number } = {}
): Promise<PaperSearchResult[]> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) throw new Error("Paper query cannot be empty.");

  const collection = await openPaperCollection(false);
  const count = await collection.count();
  if (count === 0) return [];

  const [queryEmbedding] = await embedTexts([normalizedQuery]);
  if (!queryEmbedding) throw new Error("The local embedding model returned no query vector.");

  const topK = Math.min(Math.max(1, Math.trunc(options.topK ?? 5)), 10);
  const result = await collection.query<Metadata>({
    queryEmbeddings: [queryEmbedding],
    nResults: Math.min(topK, count),
    ...(options.arxivId
      ? { where: { arxiv_id: options.arxivId.trim().replace(/v\d+$/i, "") } }
      : {}),
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
      paperId: typeof metadata?.paper_id === "string" ? metadata.paper_id : "",
      arxivId: typeof metadata?.arxiv_id === "string" ? metadata.arxiv_id : "",
      title: typeof metadata?.title === "string" ? metadata.title : "",
      page: typeof metadata?.page === "number" ? metadata.page : 0,
      chunkIndex: typeof metadata?.chunk_index === "number" ? metadata.chunk_index : 0,
      text: documents[index] ?? "",
      abstractUrl:
        typeof metadata?.abstract_url === "string" ? metadata.abstract_url : "",
      distance: distances[index] ?? null
    };
  });
}

// 将论文导读保存到对应论文目录，并保留已有版本不被覆盖。
export async function savePaperGuide(
  paperId: string,
  markdown: string,
  dataPath = config.paper.dataPath
): Promise<string> {
  const normalizedId = normalizeArxivId(paperId);
  if (!markdown.trim()) throw new Error("Paper guide Markdown cannot be empty.");

  const directory = path.join(dataPath, safePaperName(normalizedId));
  const manifest = await readManifest(path.join(directory, "metadata.json"));
  if (manifest?.paper.id !== normalizedId) {
    throw new Error(`Paper is not imported: ${normalizedId}`);
  }

  for (let version = 1; version <= 1_000; version += 1) {
    const fileName = version === 1 ? "guide.md" : `guide-${version}.md`;
    const filePath = path.join(directory, fileName);
    try {
      await writeFile(filePath, `${markdown.trimEnd()}\n`, { encoding: "utf8", flag: "wx" });
      return filePath;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }

  throw new Error(`Too many saved guides for paper: ${normalizedId}`);
}
