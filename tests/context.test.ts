import assert from "node:assert/strict";
import type { ResponseInput } from "openai/resources/responses/responses";
import { buildModelContext } from "../src/context.js";

// 创建包含工具调用的一轮完整测试历史。
function completedToolTurn(label: string, output: string): ResponseInput {
  return [
    { role: "user", content: `${label}-user` },
    {
      type: "function_call",
      call_id: `${label}-call`,
      name: "read_file",
      arguments: "{}"
    },
    {
      type: "function_call_output",
      call_id: `${label}-call`,
      output
    },
    { role: "assistant", content: `${label}-assistant` }
  ];
}

const oldOutput = `HEAD-${"x".repeat(200)}-TAIL`;
const currentOutput = `CURRENT-${"y".repeat(200)}`;
const separatedHistory: ResponseInput = [
  ...completedToolTurn("old", oldOutput),
  { role: "user", content: "current-user" },
  {
    type: "function_call",
    call_id: "current-call",
    name: "read_file",
    arguments: "{}"
  },
  {
    type: "function_call_output",
    call_id: "current-call",
    output: currentOutput
  }
];
const separatedSnapshot = structuredClone(separatedHistory);
const separated = buildModelContext(separatedHistory, {
  currentRunStart: 4,
  maxCharacters: 100_000,
  maxOldToolOutputCharacters: 40
});
const oldResult = separated.input[2];
const currentResult = separated.input[6];

assert.deepEqual(separatedHistory, separatedSnapshot, "构建模型上下文不应改写完整会话");
assert.notStrictEqual(separated.input, separatedHistory);
assert.notStrictEqual(separated.input[0], separatedHistory[0]);
assert.equal(oldResult?.type, "function_call_output");
assert.equal(currentResult?.type, "function_call_output");
if (oldResult?.type === "function_call_output") {
  assert.equal(oldResult.call_id, "old-call");
  assert.match(String(oldResult.output), /旧工具输出已确定性裁剪/);
  assert.match(String(oldResult.output), /^HEAD-/);
  assert.match(String(oldResult.output), /TAIL$/);
}
if (currentResult?.type === "function_call_output") {
  assert.equal(currentResult.output, currentOutput, "当前轮工具结果必须保持完整");
}
assert.equal(separated.stats.compactedToolOutputs, 1);
assert.equal(separated.stats.removedToolOutputCharacters, oldOutput.length - 40);

const unfinishedOutput = "z".repeat(200);
const unfinishedHistory: ResponseInput = [
  { role: "user", content: "old-user" },
  {
    type: "function_call",
    call_id: "unfinished-call",
    name: "read_file",
    arguments: "{}"
  },
  {
    type: "function_call_output",
    call_id: "unfinished-call",
    output: unfinishedOutput
  },
  { role: "user", content: "current-user" }
];
const unfinished = buildModelContext(unfinishedHistory, {
  currentRunStart: 3,
  maxCharacters: 100_000,
  maxOldToolOutputCharacters: 20
});
const unfinishedResult = unfinished.input[2];

assert.equal(unfinishedResult?.type, "function_call_output");
if (unfinishedResult?.type === "function_call_output") {
  assert.equal(unfinishedResult.output, unfinishedOutput, "未被助手消费的结果不应压缩");
}
assert.equal(unfinished.stats.compactedToolOutputs, 0);

const firstTurn = completedToolTurn("first", "1".repeat(80));
const secondTurn = completedToolTurn("second", "2".repeat(80));
const thirdTurn = completedToolTurn("third", "3".repeat(80));
const currentRun: ResponseInput = [{ role: "user", content: "current-run-must-stay" }];
const slidingHistory: ResponseInput = [...firstTurn, ...secondTurn, ...thirdTurn, ...currentRun];
const expectedWindow: ResponseInput = [...thirdTurn, ...currentRun];
const sliding = buildModelContext(slidingHistory, {
  currentRunStart: firstTurn.length + secondTurn.length + thirdTurn.length,
  maxCharacters: JSON.stringify(expectedWindow).length,
  maxOldToolOutputCharacters: 1_000
});

assert.deepEqual(sliding.input, expectedWindow, "滑动窗口应删除最旧的完整轮次");
assert.equal(sliding.stats.droppedTurns, 2);
assert.equal(sliding.stats.droppedItems, firstTurn.length + secondTurn.length);
assert.equal(sliding.stats.budgetExceeded, false);
const remainingCallIds = sliding.input
  .filter((item) => item.type === "function_call" || item.type === "function_call_output")
  .map((item) => item.call_id);
assert.deepEqual(remainingCallIds, ["third-call", "third-call"]);

const oversizedCurrentRun: ResponseInput = [
  { role: "user", content: `oversized-${"q".repeat(200)}` }
];
const oversized = buildModelContext(oversizedCurrentRun, {
  currentRunStart: 0,
  maxCharacters: 10,
  maxOldToolOutputCharacters: 20
});

assert.deepEqual(oversized.input, oversizedCurrentRun, "当前轮即使超预算也不能被滑动窗口删除");
assert.equal(oversized.stats.droppedTurns, 0);
assert.equal(oversized.stats.budgetExceeded, true);

console.log(
  "PASS: session/model separation, old tool compaction, complete-turn sliding window, and current-run protection work."
);
