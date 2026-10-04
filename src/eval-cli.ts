import { runAgent } from "./agent.js";
import { requireDeepSeekApiKey } from "./config.js";
import { evaluateTrace, findEvalCase, loadEvalCases } from "./eval.js";
import type { EvalResult } from "./eval.js";
import { FileTraceStore } from "./trace.js";
import type { AgentTraceEvent, TraceSink } from "./trace.js";

// 把评估结果转换成适合终端审查的逐项报告。
function formatEvalResult(result: EvalResult): string {
  const header = `${result.status.toUpperCase()} | case=${result.caseId} | run=${result.runId}`;
  const checks = result.checks.map((check) => {
    const marker = check.passed ? "PASS" : "FAIL";
    return `${marker} ${check.name} | expected=${JSON.stringify(check.expected)} | actual=${JSON.stringify(check.actual)}`;
  });
  return [header, ...checks].join("\n");
}

// 创建既写入磁盘又能捕获当前 Run ID 的 Trace 接收器。
function createCapturedTrace(store: FileTraceStore): {
  sink: TraceSink;
  getRunId: () => string | undefined;
} {
  let runId: string | undefined;
  return {
    sink: {
      // 记录事件前保存首次出现的 Run ID。
      async record(event: AgentTraceEvent): Promise<void> {
        runId ??= event.runId;
        await store.record(event);
      }
    },
    // 返回本次隔离运行捕获到的 Run ID。
    getRunId: () => runId
  };
}

// 对已有 Trace 执行一个不调用模型的确定性评估。
async function evaluateExistingTrace(runId: string, caseId: string): Promise<EvalResult> {
  const store = new FileTraceStore();
  const evalCase = findEvalCase(await loadEvalCases(), caseId);
  return evaluateTrace(await store.load(runId), evalCase);
}

// 在隔离历史中运行用例，并立即评估新生成的 Trace。
async function runEvalCase(caseId: string): Promise<EvalResult> {
  requireDeepSeekApiKey();
  const store = new FileTraceStore();
  const evalCase = findEvalCase(await loadEvalCases(), caseId);
  const captured = createCapturedTrace(store);

  await runAgent(evalCase.prompt, {
    trace: captured.sink,
    webSearchEnabled: evalCase.webSearchEnabled,
    approveCommand: async () => false
  });

  const runId = captured.getRunId();
  if (!runId) throw new Error("Eval run produced no trace run ID.");
  return evaluateTrace(await store.load(runId), evalCase);
}

// 解析 eval:run 与 eval:trace 两种命令行模式。
async function main(): Promise<void> {
  const [mode, firstArgument, secondArgument] = process.argv.slice(2);
  let result: EvalResult;

  if (mode === "run" && firstArgument) {
    result = await runEvalCase(firstArgument);
  } else if (mode === "trace" && firstArgument && secondArgument) {
    result = await evaluateExistingTrace(firstArgument, secondArgument);
  } else {
    throw new Error(
      "Usage: eval-cli run <caseId> | eval-cli trace <runId> <caseId>"
    );
  }

  console.log(formatEvalResult(result));
  if (!result.passed) process.exitCode = 1;
}

await main().catch((error) => {
  // 统一输出评估命令的致命错误。
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
