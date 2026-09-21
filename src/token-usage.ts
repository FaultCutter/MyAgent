export interface TokenUsageSnapshot {
  modelCalls: number;
  reportedCalls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
}

interface UsageCandidate {
  input_tokens?: unknown;
  output_tokens?: unknown;
  total_tokens?: unknown;
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  input_tokens_details?: { cached_tokens?: unknown };
  output_tokens_details?: { reasoning_tokens?: unknown };
}

// 创建一份尚未收到模型响应的空 Token 统计。
export function emptyTokenUsage(): TokenUsageSnapshot {
  return {
    modelCalls: 0,
    reportedCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
    reasoningTokens: 0
  };
}

// 从多个候选字段中读取第一个有效的非负 Token 数。
function tokenNumber(...values: unknown[]): number | undefined {
  return values.find(
    (value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0
  );
}

// 将一次模型响应的 usage 累加到本轮统计中。
export function addTokenUsage(
  current: TokenUsageSnapshot,
  rawUsage: unknown
): TokenUsageSnapshot {
  const next = { ...current, modelCalls: current.modelCalls + 1 };

  if (!rawUsage || typeof rawUsage !== "object") {
    return next;
  }

  const usage = rawUsage as UsageCandidate;
  const inputTokens = tokenNumber(usage.input_tokens, usage.prompt_tokens);
  const outputTokens = tokenNumber(usage.output_tokens, usage.completion_tokens);

  if (inputTokens === undefined && outputTokens === undefined) {
    return next;
  }

  const normalizedInput = inputTokens ?? 0;
  const normalizedOutput = outputTokens ?? 0;

  return {
    modelCalls: next.modelCalls,
    reportedCalls: current.reportedCalls + 1,
    inputTokens: current.inputTokens + normalizedInput,
    outputTokens: current.outputTokens + normalizedOutput,
    totalTokens:
      current.totalTokens +
      (tokenNumber(usage.total_tokens) ?? normalizedInput + normalizedOutput),
    cachedInputTokens:
      current.cachedInputTokens +
      (tokenNumber(usage.input_tokens_details?.cached_tokens) ?? 0),
    reasoningTokens:
      current.reasoningTokens +
      (tokenNumber(usage.output_tokens_details?.reasoning_tokens) ?? 0)
  };
}
