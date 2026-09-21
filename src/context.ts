import type {
  ResponseInput,
  ResponseInputItem
} from "openai/resources/responses/responses";
import { config } from "./config.js";

export interface ContextBuildOptions {
  currentRunStart: number;
  maxCharacters?: number;
  maxOldToolOutputCharacters?: number;
}

export interface ContextBuildStats {
  sessionItems: number;
  modelItems: number;
  sessionCharacters: number;
  modelCharacters: number;
  compactedToolOutputs: number;
  removedToolOutputCharacters: number;
  droppedTurns: number;
  droppedItems: number;
  maxCharacters: number;
  budgetExceeded: boolean;
}

export interface ModelContextBuild {
  input: ResponseInput;
  stats: ContextBuildStats;
}

interface CompactionResult {
  items: ResponseInput;
  compactedToolOutputs: number;
  removedToolOutputCharacters: number;
}

// 计算上下文序列化后的字符数，作为发送前的确定性预算。
function serializedCharacters(items: ResponseInput): number {
  return JSON.stringify(items).length;
}

// 复制一个历史项，避免模型上下文改动持久化会话。
function cloneItem(item: ResponseInputItem): ResponseInputItem {
  return JSON.parse(JSON.stringify(item)) as ResponseInputItem;
}

// 判断历史项是否是用户消息，用于识别完整对话轮次。
function isUserMessage(item: ResponseInputItem): boolean {
  return "role" in item && item.role === "user";
}

// 判断指定位置之后是否已有助手答复，避免压缩尚未消费的工具结果。
function hasLaterAssistantMessage(items: ResponseInput, index: number): boolean {
  return items.slice(index + 1).some((item) => "role" in item && item.role === "assistant");
}

// 保留旧工具输出的首尾，并加入可识别的裁剪说明。
function compactToolOutput(output: string, maxCharacters: number): string {
  const headCharacters = Math.ceil(maxCharacters * 0.75);
  const tailCharacters = maxCharacters - headCharacters;
  const omittedCharacters = output.length - maxCharacters;
  const marker = `\n\n[旧工具输出已确定性裁剪：原 ${output.length} 字符，省略 ${omittedCharacters} 字符；如需完整内容请重新调用工具]\n\n`;
  const tail = tailCharacters > 0 ? output.slice(-tailCharacters) : "";

  return `${output.slice(0, headCharacters)}${marker}${tail}`;
}

// 只压缩已被旧轮次助手答复消费过的长工具输出。
function compactOldToolOutputs(
  oldItems: ResponseInput,
  maxCharacters: number
): CompactionResult {
  let compactedToolOutputs = 0;
  let removedToolOutputCharacters = 0;
  const items = oldItems.map((item, index) => {
    const clonedItem = cloneItem(item);

    if (
      clonedItem.type !== "function_call_output" ||
      typeof clonedItem.output !== "string" ||
      clonedItem.output.length <= maxCharacters ||
      !hasLaterAssistantMessage(oldItems, index)
    ) {
      return clonedItem;
    }

    compactedToolOutputs += 1;
    removedToolOutputCharacters += clonedItem.output.length - maxCharacters;

    return {
      ...clonedItem,
      output: compactToolOutput(clonedItem.output, maxCharacters)
    };
  });

  return {
    items,
    compactedToolOutputs,
    removedToolOutputCharacters
  };
}

// 按用户消息边界把旧历史分成完整对话轮次。
function groupConversationTurns(items: ResponseInput): ResponseInput[] {
  const turns: ResponseInput[] = [];
  let currentTurn: ResponseInput = [];

  for (const item of items) {
    if (isUserMessage(item) && currentTurn.length > 0) {
      turns.push(currentTurn);
      currentTurn = [];
    }
    currentTurn.push(item);
  }

  if (currentTurn.length > 0) {
    turns.push(currentTurn);
  }

  return turns;
}

// 校验上下文构建参数，尽早暴露错误配置。
function validateOptions(history: ResponseInput, options: ContextBuildOptions): {
  maxCharacters: number;
  maxOldToolOutputCharacters: number;
} {
  if (
    !Number.isInteger(options.currentRunStart) ||
    options.currentRunStart < 0 ||
    options.currentRunStart > history.length
  ) {
    throw new Error("currentRunStart must be an item index inside the session history.");
  }

  const maxCharacters =
    options.maxCharacters ?? config.agent.contextMaxCharacters;
  const maxOldToolOutputCharacters =
    options.maxOldToolOutputCharacters ??
    config.agent.oldToolOutputMaxCharacters;

  if (!Number.isInteger(maxCharacters) || maxCharacters <= 0) {
    throw new Error("maxCharacters must be a positive integer.");
  }
  if (!Number.isInteger(maxOldToolOutputCharacters) || maxOldToolOutputCharacters <= 0) {
    throw new Error("maxOldToolOutputCharacters must be a positive integer.");
  }

  return { maxCharacters, maxOldToolOutputCharacters };
}

// 构建独立的模型上下文，并依次执行旧输出裁剪和轮次滑动窗口。
export function buildModelContext(
  history: ResponseInput,
  options: ContextBuildOptions
): ModelContextBuild {
  const { maxCharacters, maxOldToolOutputCharacters } = validateOptions(history, options);
  const sessionCharacters = serializedCharacters(history);
  const oldHistory = history.slice(0, options.currentRunStart);
  const currentRun = history.slice(options.currentRunStart).map(cloneItem);
  const compacted = compactOldToolOutputs(oldHistory, maxOldToolOutputCharacters);
  const oldTurns = groupConversationTurns(compacted.items);
  let droppedTurns = 0;
  let droppedItems = 0;
  let input = [...oldTurns.flat(), ...currentRun];

  while (serializedCharacters(input) > maxCharacters && oldTurns.length > 0) {
    const removedTurn = oldTurns.shift();
    droppedTurns += 1;
    droppedItems += removedTurn?.length ?? 0;
    input = [...oldTurns.flat(), ...currentRun];
  }

  const modelCharacters = serializedCharacters(input);

  return {
    input,
    stats: {
      sessionItems: history.length,
      modelItems: input.length,
      sessionCharacters,
      modelCharacters,
      compactedToolOutputs: compacted.compactedToolOutputs,
      removedToolOutputCharacters: compacted.removedToolOutputCharacters,
      droppedTurns,
      droppedItems,
      maxCharacters,
      budgetExceeded: modelCharacters > maxCharacters
    }
  };
}
