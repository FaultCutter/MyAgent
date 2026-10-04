import { execFile } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { config } from "./config.js";
import { searchKnowledge } from "./knowledge.js";
import { importArxivPaper, savePaperGuide, searchArxiv, searchPapers } from "./paper.js";
import { searchWeb } from "./web-search.js";
import { fetchWebPage } from "./web-page.js";

const execFileAsync = promisify(execFile);
const MAX_LIST_ENTRIES = 200;
const MAX_SEARCH_RESULTS = 100;

export type ToolName =
  | "list_files"
  | "search_files"
  | "grep_files"
  | "knowledge_search"
  | "arxiv_search"
  | "paper_import"
  | "paper_search"
  | "paper_save_guide"
  | "web_search"
  | "fetch_web_page"
  | "read_file"
  | "write_file"
  | "run_command";

export const toolDefinitions = [
  {
    type: "function" as const,
    name: "list_files",
    description: "List files inside a workspace directory so you can discover the project.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative directory path; defaults to ." }
      },
      required: [],
      additionalProperties: false
    }
  },
  {
    type: "function" as const,
    name: "search_files",
    description: "Search for text inside workspace files and return matching lines.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative directory path; defaults to ." },
        query: { type: "string", description: "Text to search for, ignoring letter case" }
      },
      required: ["query"],
      additionalProperties: false
    }
  },
  {
    type: "function" as const,
    name: "grep_files",
    description: "Search workspace files with a regular expression and return matching lines.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative directory path; defaults to ." },
        pattern: { type: "string", description: "JavaScript regular expression pattern" }
      },
      required: ["pattern"],
      additionalProperties: false
    }
  },
  {
    type: "function" as const,
    name: "knowledge_search",
    description:
      "Search the user's local notes and private reference material, automatically refreshing the knowledge index when files change. Use only when the user asks for local knowledge or the task clearly depends on it; do not use for ordinary public documentation. Cite source and chunk ID.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Focused semantic search query" },
        top_k: {
          type: "number",
          description: "Number of chunks to return; defaults to 5 and is capped at 10"
        }
      },
      required: ["query"],
      additionalProperties: false
    }
  },
  {
    type: "function" as const,
    name: "arxiv_search",
    description:
      "Search arXiv metadata for academic papers. Use this instead of general web search when the user wants to discover papers. Returns titles, authors, abstracts, IDs, and PDF URLs without importing anything.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Focused paper topic or title keywords" },
        max_results: {
          type: "number",
          description: "Number of results; defaults to 5 and is capped at 10"
        }
      },
      required: ["query"],
      additionalProperties: false
    }
  },
  {
    type: "function" as const,
    name: "paper_import",
    description:
      "Download one selected arXiv PDF, extract page text, and index it in the local paper library. Use when the user identifies a paper or asks you to select one and read its full text. Requires web access and the local Chroma server.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        arxiv_id: { type: "string", description: "arXiv ID such as 1706.03762" }
      },
      required: ["arxiv_id"],
      additionalProperties: false
    }
  },
  {
    type: "function" as const,
    name: "paper_search",
    description:
      "Search the already imported local paper library. Use for questions about paper content and cite title, arXiv ID, page, and chunk ID from the returned evidence.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Focused semantic question about paper content" },
        arxiv_id: {
          type: "string",
          description: "Optional arXiv ID used to limit retrieval to one paper"
        },
        top_k: {
          type: "number",
          description: "Number of chunks to return; defaults to 5 and is capped at 10"
        }
      },
      required: ["query"],
      additionalProperties: false
    }
  },
  {
    type: "function" as const,
    name: "paper_save_guide",
    description:
      "Save a finished Markdown reading guide for an imported paper. Use the versioned paperId returned by paper_import or paper_search. Existing guides are never overwritten; returns the saved file path. No web access is required.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        paper_id: { type: "string", description: "Versioned arXiv paper ID such as 1706.03762v7" },
        content: { type: "string", description: "Complete Markdown guide to save" }
      },
      required: ["paper_id", "content"],
      additionalProperties: false
    }
  },
  {
    type: "function" as const,
    name: "web_search",
    description:
      "Search the public web for official or current information. For a simple factual lookup, make one focused search, select the best primary source, and avoid unrelated sources. Returns up to five results.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Focused web search query" }
      },
      required: ["query"],
      additionalProperties: false
    }
  },
  {
    type: "function" as const,
    name: "fetch_web_page",
    description:
      "Read a selected HTTP or HTTPS source after web_search. For long pages, use find; if it hits navigation, retry once with a distinctive sentence. Stop researching once the authoritative text supports the answer. Does not parse PDF files.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Complete HTTP or HTTPS URL returned by web_search" },
        find: {
          type: "string",
          description: "Optional text to locate; returns the surrounding section of a long page"
        }
      },
      required: ["url"],
      additionalProperties: false
    }
  },
  {
    type: "function" as const,
    name: "read_file",
    description: "Read a UTF-8 text file inside the current workspace.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative file path" }
      },
      required: ["path"],
      additionalProperties: false
    }
  },
  {
    type: "function" as const,
    name: "write_file",
    description: "Create or replace a UTF-8 text file inside the current workspace.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative file path" },
        content: { type: "string", description: "Complete new file contents" }
      },
      required: ["path", "content"],
      additionalProperties: false
    }
  },
  {
    type: "function" as const,
    name: "run_command",
    description:
      "Request approval to run a PowerShell command when execution is genuinely required. Never use it instead of web, knowledge, or file tools.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "PowerShell command to run" },
        reason: { type: "string", description: "Short explanation of why this command is needed" }
      },
      required: ["command", "reason"],
      additionalProperties: false
    }
  }
];

// 按本轮运行设置返回允许交给模型的工具定义。
export function enabledToolDefinitions(webSearchEnabled: boolean): typeof toolDefinitions {
  const webToolNames = new Set([
    "web_search",
    "fetch_web_page",
    "arxiv_search",
    "paper_import"
  ]);
  return webSearchEnabled
    ? toolDefinitions
    : toolDefinitions.filter((tool) => !webToolNames.has(tool.name));
}

// 将相对路径解析到工作区内并阻止路径越界。
function workspacePath(relativePath: string): string {
  const root = path.resolve(process.cwd());
  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(root, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes the workspace: ${relativePath}`);
  }

  return resolved;
}

// 在固定预算内保留工具输出的首尾，并明确标记裁剪行为。
function limitToolOutput(value: string, maxCharacters: number): string {
  if (value.length <= maxCharacters) return value;

  const marker = `\n\n[工具输出已裁剪：原 ${value.length} 字符，请缩小查询范围后重试]\n\n`;
  if (marker.length >= maxCharacters) return marker.slice(0, maxCharacters);

  const retainedCharacters = maxCharacters - marker.length;
  const headCharacters = Math.ceil(retainedCharacters * 0.75);
  const tailCharacters = retainedCharacters - headCharacters;
  const tail = tailCharacters > 0 ? value.slice(-tailCharacters) : "";

  return `${value.slice(0, headCharacters)}${marker}${tail}`;
}

// 解析参数并执行具体工具，输出预算由外层统一处理。
async function executeToolUnbounded(name: string, rawArguments: string): Promise<string> {
  const args: unknown = JSON.parse(rawArguments);

  if (name === "list_files") {
    const { path: directoryPath = "." } = args as { path?: string };
    const root = workspacePath(directoryPath);
    const entries: string[] = [];
    const ignored = new Set([".git", "node_modules", "dist", ".env"]);

    // 递归收集目录中的文件路径。
    async function visit(directory: string): Promise<void> {
      if (entries.length >= MAX_LIST_ENTRIES) return;

      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (ignored.has(entry.name)) continue;

        const absolutePath = path.join(directory, entry.name);
        const relative = path.relative(process.cwd(), absolutePath).split(path.sep).join("/");

        if (entry.isDirectory()) {
          await visit(absolutePath);
        } else {
          entries.push(relative);
        }

        if (entries.length >= MAX_LIST_ENTRIES) return;
      }
    }

    await visit(root);
    return entries.sort().join("\n");
  }

  if (name === "search_files") {
    const { path: directoryPath = ".", query } = args as { path?: string; query: string };
    const root = workspacePath(directoryPath);
    const matches: string[] = [];
    const ignored = new Set([".git", "node_modules", "dist", ".env"]);
    const normalizedQuery = query.toLowerCase();

    // 递归搜索目录中的文本文件并记录匹配行。
    async function visit(directory: string): Promise<void> {
      if (matches.length >= MAX_SEARCH_RESULTS) return;

      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (ignored.has(entry.name)) continue;

        const absolutePath = path.join(directory, entry.name);

        if (entry.isDirectory()) {
          await visit(absolutePath);
        } else {
          const content = await readFile(absolutePath, "utf8").catch(() => "");
          const relative = path.relative(process.cwd(), absolutePath).split(path.sep).join("/");

          for (const [index, line] of content.split(/\r?\n/).entries()) {
            if (line.toLowerCase().includes(normalizedQuery)) {
              matches.push(`${relative}:${index + 1}: ${line.trim()}`);
            }

            if (matches.length >= MAX_SEARCH_RESULTS) return;
          }
        }

        if (matches.length >= MAX_SEARCH_RESULTS) return;
      }
    }

    await visit(root);
    return matches.length === 0
      ? `No matches found for: ${query}`
      : matches.join("\n");
  }

  if (name === "grep_files") {
    const { path: directoryPath = ".", pattern } = args as {
      path?: string;
      pattern: string;
    };
    const root = workspacePath(directoryPath);
    const matches: string[] = [];
    const ignored = new Set([".git", "node_modules", "dist", ".env"]);
    const expression = new RegExp(pattern, "i");

    // 递归搜索目录并用正则表达式匹配每一行。
    async function visit(directory: string): Promise<void> {
      if (matches.length >= MAX_SEARCH_RESULTS) return;

      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (ignored.has(entry.name)) continue;

        const absolutePath = path.join(directory, entry.name);

        if (entry.isDirectory()) {
          await visit(absolutePath);
        } else {
          const content = await readFile(absolutePath, "utf8").catch(() => "");
          const relative = path.relative(process.cwd(), absolutePath).split(path.sep).join("/");

          for (const [index, line] of content.split(/\r?\n/).entries()) {
            if (expression.test(line)) {
              matches.push(`${relative}:${index + 1}: ${line.trim()}`);
            }

            if (matches.length >= MAX_SEARCH_RESULTS) return;
          }
        }

        if (matches.length >= MAX_SEARCH_RESULTS) return;
      }
    }

    await visit(root);
    return matches.length === 0
      ? `No matches found for pattern: ${pattern}`
      : matches.join("\n");
  }

  if (name === "web_search") {
    const { query } = args as { query: string };
    const results = await searchWeb(query);

    return results.length === 0
      ? `No web results found for: ${query}`
      : JSON.stringify({ query, results }, null, 2);
  }

  if (name === "arxiv_search") {
    const { query, max_results: maxResults = 5 } = args as {
      query: string;
      max_results?: number;
    };
    const results = await searchArxiv(query, maxResults);

    return results.length === 0
      ? `No arXiv results found for: ${query}`
      : JSON.stringify({ query, results }, null, 2);
  }

  if (name === "paper_import") {
    const { arxiv_id: arxivId } = args as { arxiv_id: string };
    return JSON.stringify(await importArxivPaper(arxivId), null, 2);
  }

  if (name === "paper_search") {
    const {
      query,
      arxiv_id: arxivId,
      top_k: topK = 5
    } = args as { query: string; arxiv_id?: string; top_k?: number };
    const results = await searchPapers(query, { arxivId, topK });

    return results.length === 0
      ? `No imported paper results found for: ${query}`
      : JSON.stringify({ query, results }, null, 2);
  }

  if (name === "paper_save_guide") {
    const { paper_id: paperId, content } = args as { paper_id: string; content: string };
    return `Saved paper guide: ${await savePaperGuide(paperId, content)}`;
  }

  if (name === "fetch_web_page") {
    const { url, find } = args as { url: string; find?: string };
    const page = await fetchWebPage(url, find);

    return [
      `URL: ${page.url}`,
      ...(page.title ? [`Title: ${page.title}`] : []),
      `Content-Type: ${page.contentType}`,
      "",
      page.content
    ].join("\n");
  }

  if (name === "knowledge_search") {
    const { query, top_k: topK = 5 } = args as { query: string; top_k?: number };
    const results = await searchKnowledge(query, topK);

    return results.length === 0
      ? `No local knowledge results found for: ${query}`
      : JSON.stringify({ query, results }, null, 2);
  }

  if (name === "read_file") {
    const { path: filePath } = args as { path: string };
    return readFile(workspacePath(filePath), "utf8");
  }

  if (name === "write_file") {
    const { path: filePath, content } = args as { path: string; content: string };
    await writeFile(workspacePath(filePath), content, "utf8");
    return `Wrote ${content.length} characters to ${filePath}`;
  }

  if (name === "run_command") {
    const { command } = args as { command: string };

    const childEnvironment = { ...process.env };
    delete childEnvironment.DEEPSEEK_API_KEY;

    const powerShell = path.join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe"
    );
    const { stdout, stderr } = await execFileAsync(
      powerShell,
      ["-NoProfile", "-NonInteractive", "-Command", command.trim()],
      {
        cwd: process.cwd(),
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
        env: childEnvironment,
        encoding: "utf8"
      }
    );
    return [`exit: 0`, stdout && `stdout:\n${stdout}`, stderr && `stderr:\n${stderr}`]
      .filter(Boolean)
      .join("\n");
  }

  throw new Error(`Unknown tool: ${name}`);
}

// 执行工具并在结果进入 Agent Loop 前统一应用输出预算。
export async function executeTool(
  name: string,
  rawArguments: string,
  maxOutputCharacters: number = config.agent.toolOutputMaxCharacters
): Promise<string> {
  if (!Number.isInteger(maxOutputCharacters) || maxOutputCharacters <= 0) {
    throw new Error("Tool output max characters must be a positive integer.");
  }

  return limitToolOutput(
    await executeToolUnbounded(name, rawArguments),
    maxOutputCharacters
  );
}
