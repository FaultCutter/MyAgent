import assert from "node:assert/strict";
import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ResponseInput } from "openai/resources/responses/responses";
import { runAgent } from "../src/agent.js";
import { createConfig } from "../src/config.js";
import { SessionStore } from "../src/session.js";
import type { AgentTraceEvent, TraceSink } from "../src/trace.js";

class TestTraceSink implements TraceSink {
  readonly events: AgentTraceEvent[] = [];

  // 在内存中收集 Agent 事件，供集成测试断言。
  async record(event: AgentTraceEvent): Promise<void> {
    this.events.push(event);
  }
}

const testDirectory = await mkdtemp(path.join(tmpdir(), "my-agent-session-"));
const store = new SessionStore(testDirectory);

try {
  const firstSession = await store.create();
  const firstHistory: ResponseInput = [{ role: "user", content: "第一段会话" }];
  await store.save(firstSession.id, firstHistory);

  const secondSession = await store.create();
  assert.notEqual(secondSession.id, firstSession.id);
  assert.deepEqual(secondSession.history, []);

  const sessionFiles = (await readdir(path.join(testDirectory, "sessions"))).filter((file) =>
    file.endsWith(".json")
  );
  assert.equal(sessionFiles.length, 2, "新会话应立即创建独立文件，并保留旧会话");
  assert.equal((await store.loadCurrent()).id, secondSession.id);

  await store.select(firstSession.id);
  assert.deepEqual((await store.loadCurrent()).history, firstHistory);

  const thirdSession = await store.create();
  const traceSink = new TestTraceSink();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("simulated model failure");
  };

  try {
    await assert.rejects(
      runAgent(
        "即使模型失败也保存我",
        {
          sessionId: thirdSession.id,
          trace: traceSink,
          onHistoryChange: async (history) => {
            await store.save(thirdSession.id, history);
          }
        },
        thirdSession.history,
        createConfig({
          DEEPSEEK_API_KEY: "test-key",
          DEEPSEEK_BASE_URL: "http://127.0.0.1:1",
          DEEPSEEK_MODEL: "test-model",
          DEEPSEEK_REASONING_EFFORT: "low",
          AGENT_MAX_STEPS: "1"
        })
      )
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual((await store.load(thirdSession.id)).history, [
    { role: "user", content: "即使模型失败也保存我" }
  ]);
  assert.deepEqual(
    traceSink.events.map((event) => event.type),
    ["run_started", "run_failed"],
    "模型失败也应保留可审查的完整失败轨迹"
  );
  assert.equal(traceSink.events[0]?.sessionId, thirdSession.id);
  assert.equal(traceSink.events[1]?.sessionId, thirdSession.id);
  assert.equal(traceSink.events[0]?.runId, traceSink.events[1]?.runId);

  const deletionStore = new SessionStore(path.join(testDirectory, "delete-case"));
  const sessionToDelete = await deletionStore.create();
  const remainingSession = await deletionStore.create();
  await deletionStore.select(sessionToDelete.id);

  const selectedAfterDelete = await deletionStore.delete(sessionToDelete.id);
  assert.equal(selectedAfterDelete.id, remainingSession.id);
  assert.equal((await deletionStore.list()).length, 1);

  const replacementSession = await deletionStore.delete(remainingSession.id);
  assert.notEqual(replacementSession.id, remainingSession.id);
  assert.deepEqual(replacementSession.history, []);
  assert.equal((await deletionStore.list()).length, 1, "删除最后一个会话后应立即创建空会话");

  const recoveryDirectory = path.join(testDirectory, "startup-recovery");
  const recoveryStore = new SessionStore(recoveryDirectory);
  const existingSession = await recoveryStore.create([
    { role: "user", content: "启动时应恢复这个会话" }
  ]);
  await assert.rejects(access(path.join(recoveryDirectory, "current-session.json")), {
    code: "ENOENT"
  });

  const restartedStore = new SessionStore(recoveryDirectory);
  const restoredSession = await restartedStore.loadCurrent();
  assert.equal(restoredSession.id, existingSession.id);
  assert.equal((await restartedStore.list()).length, 1, "已有会话时启动不应额外创建会话");
  await assert.rejects(access(path.join(recoveryDirectory, "current-session.json")), {
    code: "ENOENT"
  });

  console.log(
    "PASS: existing sessions are restored; sessions can be created, selected, deleted, and saved incrementally."
  );
} finally {
  await rm(testDirectory, { recursive: true, force: true });
}
