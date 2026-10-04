import type { AppConfig } from "./config.js";
import { requireJevApiKey } from "./config.js";

export type JevRecommendation = "allow" | "review" | "deny";

export type JevCommandReview =
  | {
      status: "ok";
      recommendation: JevRecommendation;
      confidence?: number;
      probabilities?: Partial<Record<JevRecommendation, number>>;
    }
  | { status: "unavailable"; error: string };

const RECOMMENDATIONS: Record<JevRecommendation, string> = {
  allow: "倾向允许：看起来与任务相关，且影响较小或容易撤销。",
  review: "谨慎复核：可能修改状态、访问网络，或副作用尚不明确。",
  deny: "倾向拒绝：看起来有明显破坏、越界或泄露风险。"
};
const RECOMMENDATION_LABELS: Record<JevRecommendation, string> = {
  allow: "倾向允许",
  review: "谨慎复核",
  deny: "倾向拒绝"
};

// 隐去常见密钥形式，减少发送到 Jev 网关的敏感信息。
export function redactCommandSecrets(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, "[已隐藏密钥]")
    .replace(/(Bearer\s+)\S+/gi, "$1[已隐藏密钥]")
    .replace(/((?:API_KEY|PASSWORD|TOKEN|SECRET)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|\S+)/gi, "$1[已隐藏密钥]");
}

// 解析网关可能返回的原生或 data 包裹的 Jev 选项答案。
export function parseJevCommandReview(value: unknown): Extract<JevCommandReview, { status: "ok" }> {
  if (!value || typeof value !== "object") throw new Error("Jev returned invalid JSON.");
  const response = value as Record<string, unknown>;
  if (response.code !== undefined && response.code !== 0) {
    throw new Error("Jev returned an unsuccessful decision.");
  }
  const envelope = response.data && typeof response.data === "object"
    ? response.data as Record<string, unknown>
    : response;
  const answers = envelope.answers;
  const answer = answers && typeof answers === "object"
    ? (answers as Record<string, unknown>).recommendation
    : undefined;
  if (!answer || typeof answer !== "object") {
    throw new Error("Jev response has no recommendation answer.");
  }
  const choice = answer as Record<string, unknown>;
  if (typeof choice.choice !== "string" || !Object.hasOwn(RECOMMENDATIONS, choice.choice)) {
    throw new Error("Jev selected an unknown recommendation.");
  }
  const probabilities: Partial<Record<JevRecommendation, number>> = {};
  if (choice.probabilities && typeof choice.probabilities === "object") {
    for (const key of Object.keys(RECOMMENDATIONS) as JevRecommendation[]) {
      const value = (choice.probabilities as Record<string, unknown>)[key];
      if (typeof value === "number" && value >= 0 && value <= 1) probabilities[key] = value;
    }
  }
  return {
    status: "ok",
    recommendation: choice.choice as JevRecommendation,
    ...(typeof choice.confidence === "number" && choice.confidence >= 0 && choice.confidence <= 1
      ? { confidence: choice.confidence }
      : {}),
    ...(Object.keys(probabilities).length ? { probabilities } : {})
  };
}

// 将待审批命令交给 Jev 给出辅助建议，不执行命令或替用户审批。
export async function reviewCommandWithJev(
  task: string,
  command: string,
  reason: string,
  runtimeConfig: AppConfig,
  fetcher: typeof fetch = fetch
): Promise<Extract<JevCommandReview, { status: "ok" }>> {
  const payload = {
    model: runtimeConfig.jev.model,
    state: {
      user_task: redactCommandSecrets(task).slice(0, 2_000),
      command: redactCommandSecrets(command).slice(0, 4_000),
      agent_reason: redactCommandSecrets(reason).slice(0, 1_000),
      policy: "The command always requires explicit human approval. This decision is only advice."
    },
    questions: {
      recommendation: {
        type: "choice",
        instructions: "为人工审批者选择最合适的辅助建议。不要把建议当成执行授权。",
        criteria: RECOMMENDATIONS
      }
    }
  };
  const response = await fetcher(new URL("/v1/systemone", runtimeConfig.jev.baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireJevApiKey(runtimeConfig)}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8_000)
  });
  if (!response.ok) throw new Error(`Jev request failed with HTTP ${response.status}.`);
  return parseJevCommandReview(await response.json() as unknown);
}

// 将 Jev 结构化判断整理为 CLI 和 Web 共用的中文提示。
export function formatJevCommandReview(review: JevCommandReview | null): string | null {
  if (!review) return null;
  if (review.status === "unavailable") {
    return `Jev 辅助判断不可用：${review.error}\n仍由你决定是否批准。`;
  }
  const confidence = review.confidence === undefined
    ? ""
    : `（置信度 ${Math.round(review.confidence * 100)}%）`;
  const probabilities = review.probabilities
    ? Object.entries(review.probabilities)
        .map(([key, value]) => `${RECOMMENDATION_LABELS[key as JevRecommendation]} ${Math.round(value * 100)}%`)
        .join("、")
    : "";
  return `Jev 辅助建议：${RECOMMENDATION_LABELS[review.recommendation]}${confidence}${probabilities ? `\n选项概率：${probabilities}。` : ""}\n这是类别判断，不提供逐条理由；最终由你审批。`;
}
