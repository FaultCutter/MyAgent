import assert from "node:assert/strict";
import { addTokenUsage, emptyTokenUsage } from "../src/token-usage.js";

let usage = emptyTokenUsage();

usage = addTokenUsage(usage, {
  input_tokens: 120,
  output_tokens: 30,
  total_tokens: 150,
  input_tokens_details: { cached_tokens: 20 },
  output_tokens_details: { reasoning_tokens: 10 }
});
usage = addTokenUsage(usage, {
  prompt_tokens: 200,
  completion_tokens: 50
});
usage = addTokenUsage(usage, undefined);

assert.deepEqual(usage, {
  modelCalls: 3,
  reportedCalls: 2,
  inputTokens: 320,
  outputTokens: 80,
  totalTokens: 400,
  cachedInputTokens: 20,
  reasoningTokens: 10
});

console.log("PASS: token usage is normalized and accumulated across model calls.");
