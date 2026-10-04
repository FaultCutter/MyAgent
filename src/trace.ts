import { appendFile, mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { ContextBuildStats } from "./context.js";
import type { TokenUsageSnapshot } from "./token-usage.js";

interface TraceEventBase {
  runId: string;
  sessionId?: string;
  sequence: number;
  timestamp: string;
}

export type TraceStopReason = "final_answer" | "max_steps" | "model_error" | "cancelled";

export type AgentTraceEvent =
  | (TraceEventBase & {
      type: "run_started";
      task: string;
      model: string;
      webSearchEnabled: boolean;
    })
  | (TraceEventBase & {
      type: "model_call_completed";
      step: number;
      durationMs: number;
      usage: TokenUsageSnapshot;
      context: ContextBuildStats;
    })
  | (TraceEventBase & {
      type: "tool_call_started";
      step: number;
      callId: string;
      tool: string;
      arguments: unknown;
    })
  | (TraceEventBase & {
      type: "tool_call_completed";
      step: number;
      callId: string;
      tool: string;
      status: "success" | "error" | "denied";
      durationMs: number;
      outputCharacters: number;
      truncated: boolean;
      error?: string;
    })
  | (TraceEventBase & {
      type: "approval_requested";
      step: number;
      callId: string;
      tool: string;
      command: string;
      reason: string;
    })
  | (TraceEventBase & {
      type: "jev_review_completed";
      step: number;
      callId: string;
      status: "ok" | "unavailable";
      durationMs: number;
      recommendation?: "allow" | "review" | "deny";
      confidence?: number;
      probabilities?: Partial<Record<"allow" | "review" | "deny", number>>;
      error?: string;
    })
  | (TraceEventBase & {
      type: "approval_resolved";
      step: number;
      callId: string;
      approved: boolean;
      waitingDurationMs: number;
    })
  | (TraceEventBase & {
      type: "run_completed";
      answer: string;
      durationMs: number;
      stopReason: "final_answer";
      usage: TokenUsageSnapshot;
    })
  | (TraceEventBase & {
      type: "run_failed";
      durationMs: number;
      stopReason: Exclude<TraceStopReason, "final_answer">;
      error: string;
      usage: TokenUsageSnapshot;
    });

export type AgentTraceEventInput = AgentTraceEvent extends infer Event
  ? Event extends TraceEventBase
    ? Omit<Event, keyof TraceEventBase>
    : never
  : never;

export interface TraceSummary {
  runId: string;
  sessionId?: string;
  task: string;
  startedAt: string;
  updatedAt: string;
  eventCount: number;
  status: "running" | "completed" | "failed";
}

export interface TraceSink {
  record(event: AgentTraceEvent): Promise<void>;
}

// 使用独立 JSONL 文件保存并读取每次 Agent Run 的结构化事件。
export class FileTraceStore implements TraceSink {
  // 创建使用指定目录的 Trace 存储器。
  constructor(private readonly tracesDirectory = path.resolve(".myagent", "traces")) {}

  // 立即把一个事件追加到对应 Run 的 JSONL 文件。
  async record(event: AgentTraceEvent): Promise<void> {
    this.assertRunId(event.runId);
    if (!Number.isInteger(event.sequence) || event.sequence <= 0) {
      throw new Error("Trace event sequence must be a positive integer.");
    }

    await mkdir(this.tracesDirectory, { recursive: true });
    await appendFile(
      path.join(this.tracesDirectory, `${event.runId}.jsonl`),
      `${JSON.stringify(event)}\n`,
      "utf8"
    );
  }

  // 按写入顺序读取一个 Run 的全部 Trace 事件。
  async load(runId: string): Promise<AgentTraceEvent[]> {
    this.assertRunId(runId);
    const content = await readFile(
      path.join(this.tracesDirectory, `${runId}.jsonl`),
      "utf8"
    );

    return content
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => this.parseEvent(JSON.parse(line) as unknown, runId));
  }

  // 列出全部 Trace，并从首尾事件生成轻量摘要。
  async list(): Promise<TraceSummary[]> {
    try {
      const fileNames = await readdir(this.tracesDirectory);
      const summaries = await Promise.all(
        fileNames
          .filter((fileName) => fileName.endsWith(".jsonl"))
          .map(async (fileName) => {
            const runId = path.basename(fileName, ".jsonl");
            const events = await this.load(runId);
            const first = events[0];
            const last = events.at(-1);
            if (!first || first.type !== "run_started" || !last) {
              throw new Error(`Trace ${runId} is missing its run_started event.`);
            }

            return {
              runId,
              ...(first.sessionId ? { sessionId: first.sessionId } : {}),
              task: first.task,
              startedAt: first.timestamp,
              updatedAt: last.timestamp,
              eventCount: events.length,
              status:
                last.type === "run_completed"
                  ? "completed" as const
                  : last.type === "run_failed"
                    ? "failed" as const
                    : "running" as const
            };
          })
      );

      return summaries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  // 校验磁盘事件至少包含正确的 Run ID、类型与序号。
  private parseEvent(value: unknown, runId: string): AgentTraceEvent {
    if (!value || typeof value !== "object") {
      throw new Error(`Trace ${runId} contains a non-object event.`);
    }

    const event = value as Partial<AgentTraceEvent>;
    if (
      event.runId !== runId ||
      typeof event.type !== "string" ||
      typeof event.timestamp !== "string" ||
      !Number.isInteger(event.sequence)
    ) {
      throw new Error(`Trace ${runId} contains an invalid event.`);
    }

    return event as AgentTraceEvent;
  }

  // 限制 Run ID 为 UUID，避免通过文件名越界访问。
  private assertRunId(runId: string): void {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId)) {
      throw new Error("Invalid trace run ID.");
    }
  }
}
