import path from "node:path";
import { parsePdfFile } from "./pdf.js";
import { importArxivPaper, searchArxiv, searchPapers } from "./paper.js";

// 输出论文命令行工具的最小使用说明。
function printUsage(): void {
  console.log(`Usage:
  npm run paper -- parse <pdf-path>
  npm run paper -- search <keywords>
  npm run paper -- import <arxiv-id>
  npm run paper -- query <question> [--paper <arxiv-id>]`);
}

// 运行论文解析、检索、导入或查询命令。
async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  if (command === "parse") {
    const filePath = args[0];
    if (!filePath) throw new Error("A PDF path is required.");
    const parsed = await parsePdfFile(path.resolve(filePath));
    const characters = parsed.pages.reduce((sum, page) => sum + page.text.length, 0);
    console.log(
      JSON.stringify(
        {
          path: path.resolve(filePath),
          pageCount: parsed.pageCount,
          characters,
          firstPagePreview: parsed.pages[0]?.text.slice(0, 500) ?? ""
        },
        null,
        2
      )
    );
    return;
  }

  if (command === "search") {
    const query = args.join(" ").trim();
    if (!query) throw new Error("Search keywords are required.");
    console.log(JSON.stringify(await searchArxiv(query), null, 2));
    return;
  }

  if (command === "import") {
    const arxivId = args[0];
    if (!arxivId) throw new Error("An arXiv ID is required.");
    console.log(JSON.stringify(await importArxivPaper(arxivId), null, 2));
    return;
  }

  if (command === "query") {
    const paperFlagIndex = args.indexOf("--paper");
    const arxivId = paperFlagIndex >= 0 ? args[paperFlagIndex + 1] : undefined;
    if (paperFlagIndex >= 0 && !arxivId) throw new Error("--paper requires an arXiv ID.");
    const queryArguments = paperFlagIndex >= 0 ? args.slice(0, paperFlagIndex) : args;
    const query = queryArguments.join(" ");
    if (!query.trim()) throw new Error("A paper question is required.");
    console.log(JSON.stringify(await searchPapers(query, { arxivId }), null, 2));
    return;
  }

  printUsage();
  if (command) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
