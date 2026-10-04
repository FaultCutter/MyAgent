import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileTraceStore } from "../src/trace.js";
import type { AgentTraceEvent } from "../src/trace.js";

const traceRoot = await mkdtemp(path.join(tmpdir(), "my-agent-trace-"));
const store = new FileTraceStore(traceRoot);
const runId = "11111111-1111-4111-8111-111111111111";
const otherRunId = "22222222-2222-4222-8222-222222222222";

const started: AgentTraceEvent = {
  type: "run_started",
  runId,
  sequence: 1,
  timestamp: "2026-09-22T00:00:00.000Z",
  task: "读取官方文档",
  model: "test-model",
  webSearchEnabled: true
};
const completed: AgentTraceEvent = {
  type: "run_completed",
  runId,
  sequence: 2,
  timestamp: "2026-09-22T00:00:01.000Z",
  answer: "完成",
  durationMs: 1_000,
  stopReason: "final_answer",
  usage: {
    modelCalls: 1,
    reportedCalls: 1,
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
    cachedInputTokens: 0,
    reasoningTokens: 0
  }
};

try {
  await store.record(started);
  await store.record(completed);
  await store.record({ ...started, runId: otherRunId });

  assert.deepEqual(await store.load(runId), [started, completed]);
  assert.deepEqual(await store.load(otherRunId), [{ ...started, runId: otherRunId }]);
  assert.deepEqual(
    (await store.list()).map((item) => item.runId).sort(),
    [otherRunId, runId].sort()
  );

  console.log("PASS: trace events persist as isolated JSONL runs and load in sequence.");
} finally {
  await rm(traceRoot, { recursive: true, force: true });
}
