import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AgentTraceEvent } from "./trace.js";

export interface EvalExpectation {
  requiredTools?: string[];
  forbiddenTools?: string[];
  maxToolCalls?: number;
  maxModelCalls?: number;
  maxToolErrors?: number;
  requiredAnswerPatterns?: string[];
}

export interface EvalCase {
  id: string;
  name: string;
  prompt: string;
  webSearchEnabled: boolean;
  expect: EvalExpectation;
}

export interface EvalCheck {
  name: string;
  passed: boolean;
  expected: unknown;
  actual: unknown;
}

export interface EvalResult {
  caseId: string;
  runId: string;
  status: "pass" | "fail" | "incomplete";
  passed: boolean;
  checks: EvalCheck[];
}

// 从后向前找到一次 Run 的最终完成事件。
function findCompletedEvent(
  events: AgentTraceEvent[]
): Extract<AgentTraceEvent, { type: "run_completed" }> | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === "run_completed") return event;
  }
  return undefined;
}

// 对一条完整 Trace 执行不调用模型的确定性规则评估。
export function evaluateTrace(events: AgentTraceEvent[], evalCase: EvalCase): EvalResult {
  const runId = events[0]?.runId ?? "unknown";
  const completed = findCompletedEvent(events);
  if (!completed) {
    return {
      caseId: evalCase.id,
      runId,
      status: "incomplete",
      passed: false,
      checks: []
    };
  }

  const toolCalls = events.filter((event) => event.type === "tool_call_started");
  const toolNames = toolCalls.map((event) => event.tool);
  const modelCalls = events.filter((event) => event.type === "model_call_completed").length;
  const toolErrors = events.filter(
    (event) => event.type === "tool_call_completed" && event.status === "error"
  ).length;
  const checks: EvalCheck[] = [];
  const started = events.find((event) => event.type === "run_started");

  checks.push({
    name: "case_prompt",
    passed: started?.task === evalCase.prompt,
    expected: evalCase.prompt,
    actual: started?.task
  });
  checks.push({
    name: "web_search_enabled",
    passed: started?.webSearchEnabled === evalCase.webSearchEnabled,
    expected: evalCase.webSearchEnabled,
    actual: started?.webSearchEnabled
  });

  if (evalCase.expect.requiredTools) {
    const missing = evalCase.expect.requiredTools.filter((tool) => !toolNames.includes(tool));
    checks.push({
      name: "required_tools",
      passed: missing.length === 0,
      expected: evalCase.expect.requiredTools,
      actual: toolNames
    });
  }

  if (evalCase.expect.forbiddenTools) {
    const forbidden = toolNames.filter((tool) => evalCase.expect.forbiddenTools!.includes(tool));
    checks.push({
      name: "forbidden_tools",
      passed: forbidden.length === 0,
      expected: evalCase.expect.forbiddenTools,
      actual: forbidden
    });
  }

  if (evalCase.expect.maxToolCalls !== undefined) {
    checks.push({
      name: "max_tool_calls",
      passed: toolCalls.length <= evalCase.expect.maxToolCalls,
      expected: evalCase.expect.maxToolCalls,
      actual: toolCalls.length
    });
  }

  if (evalCase.expect.maxModelCalls !== undefined) {
    checks.push({
      name: "max_model_calls",
      passed: modelCalls <= evalCase.expect.maxModelCalls,
      expected: evalCase.expect.maxModelCalls,
      actual: modelCalls
    });
  }

  if (evalCase.expect.maxToolErrors !== undefined) {
    checks.push({
      name: "max_tool_errors",
      passed: toolErrors <= evalCase.expect.maxToolErrors,
      expected: evalCase.expect.maxToolErrors,
      actual: toolErrors
    });
  }

  if (evalCase.expect.requiredAnswerPatterns) {
    const missingPatterns = evalCase.expect.requiredAnswerPatterns.filter(
      (pattern) => !new RegExp(pattern, "i").test(completed.answer)
    );
    checks.push({
      name: "required_answer_patterns",
      passed: missingPatterns.length === 0,
      expected: evalCase.expect.requiredAnswerPatterns,
      actual: missingPatterns
    });
  }

  const passed = checks.every((check) => check.passed);
  return {
    caseId: evalCase.id,
    runId,
    status: passed ? "pass" : "fail",
    passed,
    checks
  };
}

// 从项目 evals/cases.json 读取并校验全部确定性评估用例。
export async function loadEvalCases(
  casesPath = path.resolve("evals", "cases.json")
): Promise<EvalCase[]> {
  const parsed: unknown = JSON.parse(await readFile(casesPath, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("Eval cases file must contain an array.");

  return parsed.map((value) => parseEvalCase(value));
}

// 按 ID 查找一个评估用例，找不到时返回明确错误。
export function findEvalCase(cases: EvalCase[], caseId: string): EvalCase {
  const evalCase = cases.find((candidate) => candidate.id === caseId);
  if (!evalCase) throw new Error(`Eval case not found: ${caseId}`);
  return evalCase;
}

// 校验来自 JSON 文件的最小 Eval Case 结构。
function parseEvalCase(value: unknown): EvalCase {
  if (!value || typeof value !== "object") throw new Error("Eval case must be an object.");
  const candidate = value as Partial<EvalCase>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.name !== "string" ||
    typeof candidate.prompt !== "string" ||
    typeof candidate.webSearchEnabled !== "boolean" ||
    !candidate.expect ||
    typeof candidate.expect !== "object"
  ) {
    throw new Error("Eval case has an invalid structure.");
  }

  return candidate as EvalCase;
}
