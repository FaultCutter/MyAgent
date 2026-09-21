import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { config } from "./config.js";

interface ChromaBindings {
  cli(args: string[]): void;
}

// 按当前 Windows 架构加载 Chroma 官方原生绑定。
function loadChromaBindings(): ChromaBindings {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error("This learning launcher currently supports Windows x64 only.");
  }

  const require = createRequire(import.meta.url);
  return require("chromadb-js-bindings-win32-x64-msvc") as ChromaBindings;
}

// 使用 Node 包内的原生绑定启动本地 Chroma Server。
async function main(): Promise<void> {
  const { chroma } = config;

  await mkdir(chroma.dataPath, { recursive: true });
  process.once("SIGINT", () => process.exit(0));
  loadChromaBindings().cli([
    "chroma",
    "run",
    "--path",
    chroma.dataPath,
    "--host",
    chroma.host,
    "--port",
    String(chroma.port)
  ]);
}

// 统一报告 Chroma Server 的启动错误。
function reportFatalError(error: unknown): void {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

await main().catch(reportFatalError);
