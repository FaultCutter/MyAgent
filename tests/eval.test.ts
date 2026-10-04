import assert from "node:assert/strict";
import { evaluateTrace } from "../src/eval.js";
import type { EvalCase } from "../src/eval.js";
import type { AgentTraceEvent } from "../src/trace.js";

const runId = "33333333-3333-4333-8333-333333333333";
const usage = {
  modelCalls: 1,
  reportedCalls: 1,
  inputTokens: 10,
  outputTokens: 5,
  totalTokens: 15,
  cachedInputTokens: 0,
  reasoningTokens: 0
};
const events: AgentTraceEvent[] = [
  {
    type: "run_started",
    runId,
    sequence: 1,
    timestamp: "2026-09-22T00:00:00.000Z",
    task: "解释 loadEnvFile",
    model: "test-model",
    webSearchEnabled: true
  },
  {
    type: "model_call_completed",
    runId,
    sequence: 2,
    timestamp: "2026-09-22T00:00:00.100Z",
    step: 1,
    durationMs: 100,
    usage,
    context: {
      sessionItems: 1,
      modelItems: 1,
      sessionCharacters: 30,
      modelCharacters: 30,
      compactedToolOutputs: 0,
      removedToolOutputCharacters: 0,
      droppedTurns: 0,
      droppedItems: 0,
      maxCharacters: 30_000,
      budgetExceeded: false
    }
  },
  {
    type: "tool_call_started",
    runId,
    sequence: 3,
    timestamp: "2026-09-22T00:00:00.200Z",
    step: 1,
    callId: "call-1",
    tool: "web_search",
    arguments: { query: "Node.js loadEnvFile" }
  },
  {
    type: "tool_call_completed",
    runId,
    sequence: 4,
    timestamp: "2026-09-22T00:00:00.300Z",
    step: 1,
    callId: "call-1",
    tool: "web_search",
    status: "success",
    durationMs: 100,
    outputCharacters: 500,
    truncated: false
  },
  {
    type: "run_completed",
    runId,
    sequence: 5,
    timestamp: "2026-09-22T00:00:01.000Z",
    answer: "process.loadEnvFile 说明见 https://nodejs.org/api/process.html",
    durationMs: 1_000,
    stopReason: "final_answer",
    usage
  }
];

const passingCase: EvalCase = {
  id: "official-doc",
  name: "简单官方文档查询",
  prompt: "解释 loadEnvFile",
  webSearchEnabled: true,
  expect: {
    requiredTools: ["web_search"],
    forbiddenTools: ["knowledge_search", "run_command"],
    maxToolCalls: 1,
    maxModelCalls: 1,
    maxToolErrors: 0,
    requiredAnswerPatterns: ["process\\.loadEnvFile", "nodejs\\.org"]
  }
};

const passed = evaluateTrace(events, passingCase);
assert.equal(passed.status, "pass");
assert.equal(passed.passed, true);
assert.equal(passed.checks.every((check) => check.passed), true);

const failingCase: EvalCase = {
  ...passingCase,
  id: "must-fail",
  expect: {
    ...passingCase.expect,
    requiredTools: ["fetch_web_page"],
    forbiddenTools: ["web_search"],
    maxToolCalls: 0,
    requiredAnswerPatterns: ["不存在的答案模式"]
  }
};
const failed = evaluateTrace(events, failingCase);
assert.equal(failed.status, "fail");
assert.equal(failed.passed, false);
assert.deepEqual(
  failed.checks.filter((check) => !check.passed).map((check) => check.name),
  ["required_tools", "forbidden_tools", "max_tool_calls", "required_answer_patterns"]
);

const incomplete = evaluateTrace(events.slice(0, -1), passingCase);
assert.equal(incomplete.status, "incomplete");
assert.equal(incomplete.passed, false);

const mismatchedCase: EvalCase = {
  ...passingCase,
  id: "wrong-case",
  prompt: "另一个任务",
  webSearchEnabled: false
};
const mismatched = evaluateTrace(events, mismatchedCase);
assert.equal(mismatched.status, "fail");
assert.deepEqual(
  mismatched.checks.filter((check) => !check.passed).map((check) => check.name),
  ["case_prompt", "web_search_enabled"]
);

console.log("PASS: deterministic trace eval detects passing, failing, and incomplete runs.");
