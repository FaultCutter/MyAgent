import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { config } from "../src/config.js";
import { connectChroma, indexKnowledgeBase } from "../src/knowledge.js";
import { executeTool } from "../src/tools.js";

const directory = await mkdtemp(path.join(tmpdir(), "myagent-auto-index-"));
const collectionName = `myagent_auto_index_${randomUUID().replaceAll("-", "")}`;
const previousPath = config.knowledgePath;
const previousCollection = config.chroma.collection;
const documentPath = path.join(directory, "guide.md");
config.knowledgePath = directory;
config.chroma.collection = collectionName;

try {
  await writeFile(documentPath, "The local knowledge base starts with alpha notes.", "utf8");
  const firstOutput = await executeTool("knowledge_search", JSON.stringify({ query: "alpha notes" }));
  const firstResults = JSON.parse(firstOutput) as { results: Array<{ text: string }> };
  assert.match(firstResults.results[0]?.text ?? "", /alpha notes/);
  assert.equal((await indexKnowledgeBase()).changed, false, "首次检索后索引应已建立");

  await writeFile(documentPath, "The local knowledge base now contains beta notes.", "utf8");
  const updatedOutput = await executeTool("knowledge_search", JSON.stringify({ query: "beta notes" }));
  const updatedResults = JSON.parse(updatedOutput) as { results: Array<{ text: string }> };
  assert.match(updatedResults.results[0]?.text ?? "", /beta notes/);
  assert.equal((await indexKnowledgeBase()).changed, false, "文档变化后的检索应自动刷新索引");

  console.log("PASS: knowledge search creates and refreshes its index on demand.");
} finally {
  config.knowledgePath = previousPath;
  config.chroma.collection = previousCollection;
  try {
    await (await connectChroma()).deleteCollection({ name: collectionName });
  } catch {
    // 首次连接失败时可能尚未创建测试集合；保留原始测试错误。
  }
  await rm(directory, { recursive: true, force: true });
}
