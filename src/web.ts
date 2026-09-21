import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ResponseInput } from "openai/resources/responses/responses";
import { runAgent } from "./agent.js";
import type { AgentOptions } from "./agent.js";
import { config, requireDeepSeekApiKey } from "./config.js";
import type { ContextBuildStats } from "./context.js";
import { SessionStore } from "./session.js";
import { emptyTokenUsage } from "./token-usage.js";
import type { TokenUsageSnapshot } from "./token-usage.js";

interface PendingApproval {
  id: number;
  command: string;
  reason: string;
  resolve: (approved: boolean) => void;
}

interface VisibleMessage {
  role: "user" | "assistant";
  text: string;
}

interface RunState {
  message: string;
  events: string[];
  webSearchEnabled: boolean;
  usage: TokenUsageSnapshot;
  modelContext: ContextBuildStats | null;
}

const host = "127.0.0.1";
requireDeepSeekApiKey();
const port = config.agent.webPort;
const session = new SessionStore();
let activeSession = await session.loadCurrent();
let history: ResponseInput = activeSession.history;
const pagePath = path.resolve("web", "index.html");
let pendingApproval: PendingApproval | null = null;
let nextApprovalId = 1;
let chatRunning = false;
let runState: RunState = {
  message: "就绪",
  events: [],
  webSearchEnabled: config.agent.webSearchEnabled,
  usage: emptyTokenUsage(),
  modelContext: null
};

// 把 JSON 数据写入 HTTP 响应。
function sendJson(response: import("node:http").ServerResponse, status: number, data: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}

// 读取并解析请求中的 JSON 数据。
async function readJson(request: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

// 从模型历史中提取适合展示在聊天界面的用户和助手文本。
function visibleMessages(items: ResponseInput): VisibleMessage[] {
  const messages: VisibleMessage[] = [];

  for (const item of items as unknown[]) {
    if (!item || typeof item !== "object") continue;

    const candidate = item as {
      role?: string;
      content?: string | Array<{ type?: string; text?: string }>;
    };

    if (candidate.role === "user" && typeof candidate.content === "string") {
      messages.push({ role: "user", text: candidate.content });
      continue;
    }

    if (candidate.role === "assistant" && Array.isArray(candidate.content)) {
      const text = candidate.content
        .filter((part) => part.type === "output_text" && typeof part.text === "string")
        .map((part) => part.text)
        .join("\n");

      if (text) messages.push({ role: "assistant", text });
    }
  }

  return messages;
}

// 统计当前会话中可见消息、原始上下文项和序列化体积。
function contextStats(items: ResponseInput): {
  messageCount: number;
  itemCount: number;
  byteCount: number;
} {
  return {
    messageCount: visibleMessages(items).length,
    itemCount: items.length,
    byteCount: Buffer.byteLength(JSON.stringify(items), "utf8")
  };
}

// 将待审批命令转换为可以发送给浏览器的只读数据。
function visibleApproval(): { id: number; command: string; reason: string } | null {
  return pendingApproval
    ? {
        id: pendingApproval.id,
        command: pendingApproval.command,
        reason: pendingApproval.reason
      }
    : null;
}

// 暂停 Agent Loop，直到网页端批准或拒绝命令。
function requestCommandApproval(command: string, reason: string): Promise<boolean> {
  return new Promise((resolve) => {
    pendingApproval = {
      id: nextApprovalId,
      command,
      reason,
      resolve
    };
    nextApprovalId += 1;
    runState.message = "等待命令审批…";
  });
}

// 从统一项目配置创建网页会话使用的 Agent 选项。
function loadAgentOptions(events: string[], webSearchEnabled: boolean): AgentOptions {
  return {
    webSearchEnabled,
    // 收集工具调用事件并立即暴露给网页状态接口。
    onEvent: (message) => {
      events.push(message);
      runState.events = [...events];
    },
    // 把 Agent 当前阶段同步给网页状态接口。
    onStatus: (message) => {
      runState.message = message;
    },
    // 接收 Agent Loop 汇总的模型 Token 用量。
    onUsage: (usage) => {
      runState.usage = usage;
    },
    // 保存最近一次实际发送给模型的上下文统计，不改动页面设计。
    onContextBuilt: (stats) => {
      runState.modelContext = stats;
    },
    // 每次历史发生变化都写入当前会话，而不是等待整轮结束。
    onHistoryChange: async (currentHistory) => {
      await session.save(activeSession.id, currentHistory);
    },
    approveCommand: requestCommandApproval
  };
}

// 处理聊天页面和最小 JSON 接口。
async function handleRequest(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse
): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${host}:${port}`);

  if (request.method === "GET" && url.pathname === "/") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(await readFile(pagePath, "utf8"));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/messages") {
    sendJson(response, 200, {
      sessionId: activeSession.id,
      messages: visibleMessages(history)
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/sessions") {
    sendJson(response, 200, {
      currentSessionId: activeSession.id,
      sessions: await session.list()
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/status") {
    sendJson(response, 200, {
      running: chatRunning,
      message: runState.message,
      events: runState.events,
      webSearchEnabled: runState.webSearchEnabled,
      usage: runState.usage,
      modelContext: runState.modelContext,
      approval: visibleApproval(),
      context: contextStats(history)
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/approval") {
    sendJson(response, 200, visibleApproval());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/approval") {
    const body = (await readJson(request)) as { id?: number; approved?: boolean };

    if (!pendingApproval || body.id !== pendingApproval.id) {
      sendJson(response, 404, { error: "No matching command approval request." });
      return;
    }

    const approval = pendingApproval;
    pendingApproval = null;
    runState.message = body.approved === true ? "正在执行已批准的命令…" : "命令已拒绝，正在继续…";
    approval.resolve(body.approved === true);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/new") {
    if (chatRunning) {
      sendJson(response, 409, { error: "Wait for the current response to finish." });
      return;
    }

    activeSession = await session.create();
    history = activeSession.history;
    runState = {
      message: "就绪",
      events: [],
      webSearchEnabled: config.agent.webSearchEnabled,
      usage: emptyTokenUsage(),
      modelContext: null
    };
    sendJson(response, 200, { ok: true, sessionId: activeSession.id });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/session") {
    if (chatRunning) {
      sendJson(response, 409, { error: "Wait for the current response to finish." });
      return;
    }

    const body = (await readJson(request)) as { sessionId?: string };
    if (!body.sessionId) {
      sendJson(response, 400, { error: "Session ID is required." });
      return;
    }

    activeSession = await session.select(body.sessionId);
    history = activeSession.history;
    runState = {
      message: "就绪",
      events: [],
      webSearchEnabled: config.agent.webSearchEnabled,
      usage: emptyTokenUsage(),
      modelContext: null
    };
    sendJson(response, 200, { ok: true, sessionId: activeSession.id });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/session/delete") {
    if (chatRunning) {
      sendJson(response, 409, { error: "Wait for the current response to finish." });
      return;
    }

    const body = (await readJson(request)) as { sessionId?: string };
    if (!body.sessionId) {
      sendJson(response, 400, { error: "Session ID is required." });
      return;
    }

    const deletedSessionId = body.sessionId;
    activeSession = await session.delete(deletedSessionId);
    history = activeSession.history;
    runState = {
      message: "就绪",
      events: [],
      webSearchEnabled: config.agent.webSearchEnabled,
      usage: emptyTokenUsage(),
      modelContext: null
    };
    sendJson(response, 200, {
      ok: true,
      deletedSessionId,
      currentSessionId: activeSession.id
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/chat") {
    if (chatRunning) {
      sendJson(response, 409, { error: "A response is already running." });
      return;
    }

    const body = (await readJson(request)) as {
      message?: string;
      webSearchEnabled?: boolean;
    };
    const message = body.message?.trim();
    const webSearchEnabled =
      typeof body.webSearchEnabled === "boolean"
        ? body.webSearchEnabled
        : config.agent.webSearchEnabled;

    if (!message) {
      sendJson(response, 400, { error: "Message cannot be empty." });
      return;
    }

    const events: string[] = [];
    chatRunning = true;
    runState = {
      message: "正在思考…",
      events,
      webSearchEnabled,
      usage: emptyTokenUsage(),
      modelContext: null
    };

    try {
      const answer = await runAgent(
        message,
        loadAgentOptions(events, webSearchEnabled),
        history
      );
      runState.message = "回答完成";
      sendJson(response, 200, {
        answer,
        events,
        usage: runState.usage,
        modelContext: runState.modelContext
      });
    } catch (error) {
      runState.message = "运行失败";
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      chatRunning = false;
    }
    return;
  }

  sendJson(response, 404, { error: "Not found." });
}

const server = createServer((request, response) => {
  // 把异步路由错误转换为 JSON 响应。
  handleRequest(request, response).catch((error) => {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : String(error)
    });
  });
});

server.listen(port, host, () => {
  // 告知用户本地图形界面的访问地址。
  console.log(`myAgent Web UI: http://${host}:${port}`);
});
