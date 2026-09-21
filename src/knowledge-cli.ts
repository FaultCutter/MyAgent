import { indexKnowledgeBase, searchKnowledge } from "./knowledge.js";

// 执行知识库索引或手动查询命令。
async function main(): Promise<void> {
  const [command = "", ...rest] = process.argv.slice(2);

  if (command === "index") {
    const result = await indexKnowledgeBase();
    console.log(
      result.changed
        ? `Indexed ${result.documents} documents into ${result.chunks} chunks (${result.collection}).`
        : `Knowledge index is already current: ${result.documents} documents, ${result.chunks} chunks.`
    );
    return;
  }

  if (command === "query") {
    const query = rest.join(" ").trim();
    if (!query) throw new Error("Usage: npm run knowledge:query -- <query>");
    console.log(JSON.stringify(await searchKnowledge(query), null, 2));
    return;
  }

  throw new Error("Usage: tsx src/knowledge-cli.ts <index|query> [query]");
}

// 统一报告知识库命令的运行错误。
function reportFatalError(error: unknown): void {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

await main().catch(reportFatalError);
