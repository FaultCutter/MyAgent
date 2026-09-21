import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { ResponseInput } from "openai/resources/responses/responses";
import { runAgent } from "./agent.js";
import type { AgentOptions } from "./agent.js";
import { requireDeepSeekApiKey } from "./config.js";
import type { ContextBuildStats } from "./context.js";
import { SessionStore } from "./session.js";
import type { TokenUsageSnapshot } from "./token-usage.js";

const task = process.argv.slice(2).join(" ").trim();
const colorEnabled = output.isTTY && process.env.NO_COLOR === undefined;
const ANSI = {
  reset: "\u001B[0m",
  user: "\u001B[1;36m",
  agent: "\u001B[1;32m",
  tool: "\u001B[33m",
  system: "\u001B[2;37m",
  warning: "\u001B[1;33m",
  error: "\u001B[1;31m",
  stats: "\u001B[35m"
} as const;

type TerminalTone = Exclude<keyof typeof ANSI, "reset">;

interface CliRunReporter {
  options: AgentOptions;
  printSummary: () => void;
}

// 按终端能力为文本添加 ANSI 颜色，重定向输出时保持纯文本。
function colorText(text: string, tone: TerminalTone): string {
  return colorEnabled ? `${ANSI[tone]}${text}${ANSI.reset}` : text;
}

// 让提示词和用户键入内容使用同一种颜色，并在输入结束后复位。
async function questionWithColor(
  terminal: ReturnType<typeof createInterface>,
  prompt: string,
  tone: TerminalTone
): Promise<string> {
  if (!colorEnabled) return terminal.question(prompt);

  try {
    return await terminal.question(`${ANSI[tone]}${prompt}`);
  } finally {
    output.write(ANSI.reset);
  }
}

// 缓存一次用户任务的最新统计，并在任务结束后统一打印。
function createCliRunReporter(options: AgentOptions): CliRunReporter {
  let latestUsage: TokenUsageSnapshot | null = null;
  let latestContext: ContextBuildStats | null = null;
  let summaryPrinted = false;

  return {
    options: {
      ...options,
      // 工具调用仍实时显示，但使用独立颜色与最终回答区分。
      onEvent: (message) => {
        options.onEvent?.(message);
        console.error(colorText(message, "tool"));
      },
      // 只保存累计用量，避免每次模型调用都刷出一行 Token。
      onUsage: (usage) => {
        latestUsage = { ...usage };
        options.onUsage?.(usage);
      },
      // 只保存最近一次实际发送给模型的上下文状态。
      onContextBuilt: (stats) => {
        latestContext = { ...stats };
        options.onContextBuilt?.(stats);
      }
    },
    // 一次任务无论包含多少工具步骤，都只输出一次累计统计。
    printSummary: () => {
      if (summaryPrinted || (!latestUsage && !latestContext)) return;
      summaryPrinted = true;

      const parts: string[] = [];
      if (latestUsage) {
        const availability =
          latestUsage.reportedCalls === latestUsage.modelCalls
            ? ""
            : `，usage ${latestUsage.reportedCalls}/${latestUsage.modelCalls} 次可用`;
        parts.push(
          `Token 输入 ${latestUsage.inputTokens}，输出 ${latestUsage.outputTokens}，总计 ${latestUsage.totalTokens}，模型调用 ${latestUsage.modelCalls} 次${availability}`
        );
      }
      if (latestContext) {
        const exceeded = latestContext.budgetExceeded ? "，当前轮单独超出预算" : "";
        parts.push(
          `上下文 Session ${latestContext.sessionItems} 项/${latestContext.sessionCharacters} 字符 → Model ${latestContext.modelItems} 项/${latestContext.modelCharacters} 字符，压缩旧工具输出 ${latestContext.compactedToolOutputs} 个，移除旧轮次 ${latestContext.droppedTurns} 个${exceeded}`
        );
      }

      console.error(colorText(`[本轮统计] ${parts.join("\n           ")}`, "stats"));
    }
  };
}

// 为 Agent 增加复用当前终端的命令审批能力。
function withCommandApproval(
  options: AgentOptions,
  terminal: ReturnType<typeof createInterface>
): AgentOptions {
  return {
    ...options,
    // 展示命令及原因，并且只在用户明确输入 y 时批准。
    approveCommand: async (command, reason) => {
      console.log(
        colorText(`\nAgent 请求执行命令：\n${command}\n\n原因：${reason}`, "warning")
      );
      const answer = (
        await questionWithColor(terminal, "是否允许？(y/N): ", "warning")
      )
        .trim()
        .toLowerCase();
      return answer === "y" || answer === "yes";
    }
  };
}

// 打印终端内可用的斜杠命令说明。
function printHelp(): void {
  console.log("");
  console.log("会话命令：");
  console.log("  /help                显示本说明。");
  console.log("  /sessions            列出全部会话，* 表示当前会话。");
  console.log("  /new                 创建并切换到新会话，旧会话仍会保留。");
  console.log("  /use <序号或ID>       切换会话，接受列表序号、完整 ID 或唯一 ID 前缀。");
  console.log("  /delete <序号或ID>    删除会话，删除当前会话后自动切换。");
  console.log("  /exit                退出程序。");
  console.log("");
  console.log("其他输入都会作为任务交给 Agent。");
  console.log("");
}

// 展示可供终端用户选择或删除的会话列表。
async function printSessions(store: SessionStore, currentSessionId: string): Promise<void> {
  const sessions = await store.list();

  console.log("");
  sessions.forEach((item, index) => {
    const marker = item.id === currentSessionId ? "*" : " ";
    console.log(
      `${marker} ${index + 1}. ${item.title} | ${item.updatedAt} | ${item.itemCount} 项 | ${item.id}`
    );
  });
  console.log("");
}

// 将会话序号、完整 ID 或唯一 ID 前缀解析为 Session ID。
async function resolveSessionId(store: SessionStore, reference: string): Promise<string> {
  const sessions = await store.list();

  if (/^[1-9]\d*$/.test(reference)) {
    const selected = sessions[Number.parseInt(reference, 10) - 1];
    if (!selected) throw new Error(`会话序号 ${reference} 不存在。`);
    return selected.id;
  }

  const matches = sessions.filter((item) => item.id === reference || item.id.startsWith(reference));
  if (matches.length === 0) throw new Error(`会话 ${reference} 不存在。`);
  if (matches.length > 1) throw new Error(`会话 ID 前缀 ${reference} 不唯一。`);
  return matches[0]!.id;
}

// 执行一次命令行任务后退出。
async function runOneShot(userTask: string, options: AgentOptions): Promise<void> {
  const terminal = createInterface({ input, output });
  const session = new SessionStore();
  const currentSession = await session.loadCurrent();
  const history = currentSession.history;
  const reporter = createCliRunReporter({
    ...withCommandApproval(options, terminal),
    onHistoryChange: async (currentHistory) => {
      await session.save(currentSession.id, currentHistory);
    }
  });

  try {
    const result = await runAgent(userTask, reporter.options, history);
    console.log(colorText(`Agent> ${result}`, "agent"));
  } finally {
    reporter.printSummary();
    terminal.close();
  }
}

// 启动支持创建、选择和删除会话的多轮终端对话。
async function runInteractive(options: AgentOptions): Promise<void> {
  const terminal = createInterface({ input, output });
  const session = new SessionStore();
  let currentSession = await session.loadCurrent();
  let history: ResponseInput = currentSession.history;
  const interactiveOptions: AgentOptions = {
    ...withCommandApproval(options, terminal),
    onHistoryChange: async (currentHistory) => {
      await session.save(currentSession.id, currentHistory);
    }
  };

  console.log(colorText(`已进入多轮对话，已加载 ${history.length} 条历史记录。`, "system"));
  console.log(colorText("输入 /help 查看会话命令，输入 /exit 退出。\n", "system"));

  try {
    while (true) {
      const userTask = (await questionWithColor(terminal, "你> ", "user")).trim();

      if (userTask === "/exit") {
        break;
      }

      if (userTask === "/help") {
        printHelp();
        continue;
      }

      if (userTask === "/new") {
        currentSession = await session.create();
        history = currentSession.history;
        console.log(`已开始新会话 ${currentSession.id}。\n`);
        continue;
      }

      if (userTask === "/sessions") {
        await printSessions(session, currentSession.id);
        continue;
      }

      const sessionCommand = userTask.match(/^\/(use|delete)(?:\s+(.+))?$/);
      if (sessionCommand) {
        const command = sessionCommand[1];
        const reference = sessionCommand[2]?.trim();

        if (!reference) {
          console.error(`用法：/${command} <会话序号或ID>`);
          continue;
        }

        try {
          const sessionId = await resolveSessionId(session, reference);

          if (command === "use") {
            currentSession = await session.select(sessionId);
            history = currentSession.history;
            console.log(`已切换到会话 ${currentSession.id}，加载 ${history.length} 项历史。\n`);
          } else {
            const deletedCurrentSession = sessionId === currentSession.id;
            currentSession = await session.delete(sessionId);
            history = currentSession.history;
            console.log(
              `已删除会话 ${sessionId}。${
                deletedCurrentSession ? ` 当前会话已切换为 ${currentSession.id}。` : ""
              }\n`
            );
          }
        } catch (error) {
          console.error(error instanceof Error ? error.message : error);
        }
        continue;
      }

      // 未识别的斜杠命令不再交给模型，避免把命令当成任务发送。
      if (userTask.startsWith("/")) {
        const unknownCommand = userTask.split(/\s+/)[0];
        console.error(`未知命令 ${unknownCommand}。输入 /help 查看可用命令。\n`);
        continue;
      }

      if (!userTask) {
        continue;
      }

      try {
        const reporter = createCliRunReporter(interactiveOptions);
        try {
          const result = await runAgent(userTask, reporter.options, history);
          console.log(colorText(`Agent> ${result}`, "agent"));
        } finally {
          reporter.printSummary();
          console.log("");
        }
      } catch (error) {
        console.error(
          colorText(error instanceof Error ? error.message : String(error), "error")
        );
      }
    }
  } finally {
    terminal.close();
  }
}

// 根据命令行参数选择单次任务或多轮对话模式。
async function main(): Promise<void> {
  requireDeepSeekApiKey();
  const options: AgentOptions = {};

  if (task) {
    await runOneShot(task, options);
  } else {
    await runInteractive(options);
  }
}

// 统一报告启动或运行阶段的致命错误。
function reportFatalError(error: unknown): void {
  console.error(colorText(error instanceof Error ? error.message : String(error), "error"));
  process.exitCode = 1;
}

await main().catch(reportFatalError);
