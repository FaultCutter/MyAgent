import assert from "node:assert/strict";
import { runAgent } from "../src/agent.js";
import { createConfig } from "../src/config.js";
import {
  formatJevCommandReview,
  parseJevCommandReview,
  redactCommandSecrets,
  reviewCommandWithJev
} from "../src/jev.js";
import type { JevCommandReview, JevRecommendation } from "../src/jev.js";
import type { AgentTraceEvent, TraceSink } from "../src/trace.js";

const expectedReview: JevCommandReview = {
  status: "ok",
  recommendation: "review",
  confidence: 0.8,
  probabilities: { allow: 0.1, review: 0.8, deny: 0.1 }
};
assert.deepEqual(parseJevCommandReview({
  code: 0,
  data: { answers: { recommendation: {
    choice: "review", confidence: 0.8,
    probabilities: { allow: 0.1, review: 0.8, deny: 0.1 }
  } } }
}), expectedReview);
assert.deepEqual(parseJevCommandReview({
  answers: { recommendation: { choice: "deny" } }
}), { status: "ok", recommendation: "deny" });
assert.throws(() => parseJevCommandReview({
  answers: { recommendation: { choice: "toString" } }
}), /unknown recommendation/);
assert.match(formatJevCommandReview(expectedReview) ?? "", /最终由你审批/);
assert.match(formatJevCommandReview(expectedReview) ?? "", /选项概率/);
assert.match(formatJevCommandReview({ status: "unavailable", error: "HTTP 502" }) ?? "",
  /辅助判断不可用/);
assert.doesNotMatch(redactCommandSecrets("API_KEY=sk-ABCDEFGHIJKLMNOPQRST"), /ABCDEFGHIJKLMNOP/);

const runtimeConfig = createConfig({
  DEEPSEEK_API_KEY: "test-deepseek",
  DEEPSEEK_BASE_URL: "https://deepseek.test",
  JEV_ENABLED: "true",
  JEV_API_KEY: "test-jev",
  JEV_BASE_URL: "https://jev.test"
});

// 模拟 Jev 网关并检查命令、理由和密钥脱敏后的请求。
const mockJevFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  assert.equal(String(input), "https://jev.test/v1/systemone");
  assert.equal(init?.method, "POST");
  assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer test-jev");
  const body = JSON.parse(String(init?.body)) as {
    model: string;
    state: { command: string; agent_reason: string };
  };
  assert.equal(body.model, "jev-1.13");
  assert.doesNotMatch(body.state.command, /ABCDEFGHIJKLMNOP/);
  assert.equal(body.state.agent_reason, "验证目录内容");
  return new Response(JSON.stringify({
    code: 0,
    data: { answers: { recommendation: { choice: "review", confidence: 0.8 } } }
  }), { status: 200 });
}) as typeof fetch;
assert.deepEqual(
  await reviewCommandWithJev("查看目录", "echo sk-ABCDEFGHIJKLMNOPQRST", "验证目录内容", runtimeConfig, mockJevFetch),
  { status: "ok", recommendation: "review", confidence: 0.8 }
);

const originalFetch = globalThis.fetch;

// 运行一个被人工拒绝的模拟工具调用，并收集它的 Jev 审查轨迹。
async function runApprovalCase(
  jevStatus: number,
  recommendation: JevRecommendation = "deny"
): Promise<{
  review: JevCommandReview | null;
  events: AgentTraceEvent[];
  jevCalls: number;
}> {
  const events: AgentTraceEvent[] = [];
  const trace: TraceSink = {
    // 在内存中收集本轮 Agent Trace。
    async record(event) { events.push(event); }
  };
  let modelCalls = 0;
  let jevCalls = 0;
  let receivedReview: JevCommandReview | null = null;
  // 模拟 DeepSeek 提出命令、Jev 审查和 DeepSeek 最终答复。
  globalThis.fetch = (async (input: string | URL | Request) => {
    if (String(input).includes("/v1/systemone")) {
      jevCalls += 1;
      return new Response(jevStatus === 200
        ? JSON.stringify({ answers: { recommendation: { choice: recommendation, confidence: 0.9 } } })
        : "unavailable", { status: jevStatus });
    }
    modelCalls += 1;
    return new Response(JSON.stringify(modelCalls === 1
      ? { output: [{
          type: "function_call",
          name: "run_command",
          call_id: "call_test",
          arguments: JSON.stringify({ command: "Write-Output test", reason: "检查终端" })
        }], output_text: "", usage: null }
      : { output: [], output_text: "命令未执行", usage: null }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }) as typeof fetch;
  try {
    const answer = await runAgent("测试命令审批", {
      trace,
      // 拒绝命令，并记录审批前收到的辅助判断。
      approveCommand: async (_command, _reason, review) => {
        receivedReview = review;
        return false;
      }
    }, [], runtimeConfig);
    assert.equal(answer, "命令未执行");
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(modelCalls, 2);
  return { review: receivedReview, events, jevCalls };
}

const success = await runApprovalCase(200);
assert.equal(success.jevCalls, 1);
assert.deepEqual(success.review, { status: "ok", recommendation: "deny", confidence: 0.9 });
assert.ok(success.events.findIndex((event) => event.type === "jev_review_completed") <
  success.events.findIndex((event) => event.type === "approval_requested"));
assert.equal(success.events.find((event) => event.type === "approval_resolved")?.approved, false);
assert.equal(success.events.find((event) => event.type === "tool_call_completed")?.status, "denied");

const suggestedAllow = await runApprovalCase(200, "allow");
assert.deepEqual(suggestedAllow.review, {
  status: "ok", recommendation: "allow", confidence: 0.9
});
assert.equal(suggestedAllow.events.find((event) => event.type === "tool_call_completed")?.status,
  "denied", "Jev 建议允许也不能覆盖用户的拒绝");

const unavailable = await runApprovalCase(502);
assert.deepEqual(unavailable.review, { status: "unavailable", error: "Jev request failed with HTTP 502." });
assert.equal(unavailable.events.find((event) => event.type === "jev_review_completed")?.status,
  "unavailable");
assert.equal(unavailable.events.find((event) => event.type === "approval_resolved")?.approved, false);

console.log("PASS: Jev reviews commands before human approval; failures preserve the approval gate.");
