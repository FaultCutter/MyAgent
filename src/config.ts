import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { loadEnvFile } from "node:process";

export type ReasoningEffort = "low" | "high" | "max";

export interface DeepSeekConfig {
  apiKey?: string;
  model: string;
  baseUrl: string;
  reasoningEffort: ReasoningEffort;
}

export interface AgentRuntimeConfig {
  maxSteps: number;
  contextMaxCharacters: number;
  oldToolOutputMaxCharacters: number;
  toolOutputMaxCharacters: number;
  webPort: number;
  webSearchEnabled: boolean;
}

export interface ChromaConfig {
  host: string;
  port: number;
  modelPath: string;
  dataPath: string;
  collection: string;
}

export interface AppConfig {
  deepseek: DeepSeekConfig;
  agent: AgentRuntimeConfig;
  chroma: ChromaConfig;
  knowledgePath: string;
}

export const CONFIG_DEFAULTS = {
  deepseekModel: "deepseek-flash",
  deepseekBaseUrl: "https://api.deepseek.com",
  deepseekReasoningEffort: "high" as ReasoningEffort,
  agentMaxSteps: 12,
  agentContextMaxCharacters: 30_000,
  agentOldToolOutputMaxCharacters: 1_500,
  agentToolOutputMaxCharacters: 12_000,
  agentWebPort: 3_000,
  agentWebSearchEnabled: true,
  chromaHost: "127.0.0.1",
  chromaPort: 8_000,
  chromaModelPath: path.join(
    homedir(),
    ".cache",
    "chroma",
    "onnx_models",
    "all-MiniLM-L6-v2",
    "onnx"
  ),
  chromaDataPath: ".myagent/chroma",
  chromaCollection: "myagent_knowledge",
  knowledgePath: "knowledge"
} as const;

// 读取并严格校验一个正整数环境变量。
function readPositiveInteger(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number
): number {
  const rawValue = (environment[name] ?? String(fallback)).trim();

  if (!/^[1-9]\d*$/.test(rawValue)) {
    throw new Error(`${name} must be a positive integer.`);
  }

  const value = Number(rawValue);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return value;
}

// 读取并校验一个 TCP 端口环境变量。
function readPort(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number
): number {
  const rawValue = (environment[name] ?? String(fallback)).trim();
  const value = Number(rawValue);

  if (!/^[1-9]\d*$/.test(rawValue) || !Number.isSafeInteger(value) || value > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }

  return value;
}

// 读取并校验 DeepSeek reasoning effort。
function readReasoningEffort(environment: NodeJS.ProcessEnv): ReasoningEffort {
  const value =
    environment.DEEPSEEK_REASONING_EFFORT ?? CONFIG_DEFAULTS.deepseekReasoningEffort;

  if (value !== "low" && value !== "high" && value !== "max") {
    throw new Error("DEEPSEEK_REASONING_EFFORT must be low, high, or max.");
  }

  return value;
}

// 读取并严格校验 true/false 布尔环境变量。
function readBoolean(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: boolean
): boolean {
  const rawValue = (environment[name] ?? String(fallback)).trim().toLowerCase();

  if (rawValue !== "true" && rawValue !== "false") {
    throw new Error(`${name} must be true or false.`);
  }

  return rawValue === "true";
}

// 项目根目录存在 .env 时自动加载，已有进程环境变量保持优先。
function loadLocalEnvFile(): void {
  const envPath = path.resolve(".env");
  if (existsSync(envPath)) loadEnvFile(envPath);
}

// 根据给定环境对象创建一份经过转换和校验的项目配置。
export function createConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const apiKey = environment.DEEPSEEK_API_KEY?.trim();

  return {
    deepseek: {
      ...(apiKey ? { apiKey } : {}),
      model: environment.DEEPSEEK_MODEL ?? CONFIG_DEFAULTS.deepseekModel,
      baseUrl: environment.DEEPSEEK_BASE_URL ?? CONFIG_DEFAULTS.deepseekBaseUrl,
      reasoningEffort: readReasoningEffort(environment)
    },
    agent: {
      maxSteps: readPositiveInteger(
        environment,
        "AGENT_MAX_STEPS",
        CONFIG_DEFAULTS.agentMaxSteps
      ),
      contextMaxCharacters: readPositiveInteger(
        environment,
        "AGENT_CONTEXT_MAX_CHARS",
        CONFIG_DEFAULTS.agentContextMaxCharacters
      ),
      oldToolOutputMaxCharacters: readPositiveInteger(
        environment,
        "AGENT_OLD_TOOL_OUTPUT_MAX_CHARS",
        CONFIG_DEFAULTS.agentOldToolOutputMaxCharacters
      ),
      toolOutputMaxCharacters: readPositiveInteger(
        environment,
        "AGENT_TOOL_OUTPUT_MAX_CHARS",
        CONFIG_DEFAULTS.agentToolOutputMaxCharacters
      ),
      webPort: readPort(environment, "AGENT_WEB_PORT", CONFIG_DEFAULTS.agentWebPort),
      webSearchEnabled: readBoolean(
        environment,
        "AGENT_WEB_SEARCH_ENABLED",
        CONFIG_DEFAULTS.agentWebSearchEnabled
      )
    },
    chroma: {
      host: environment.CHROMA_HOST ?? CONFIG_DEFAULTS.chromaHost,
      port: readPort(environment, "CHROMA_PORT", CONFIG_DEFAULTS.chromaPort),
      modelPath: path.resolve(
        environment.CHROMA_MODEL_PATH ?? CONFIG_DEFAULTS.chromaModelPath
      ),
      dataPath: path.resolve(
        environment.CHROMA_DATA_PATH ?? CONFIG_DEFAULTS.chromaDataPath
      ),
      collection: environment.CHROMA_COLLECTION ?? CONFIG_DEFAULTS.chromaCollection
    },
    knowledgePath: path.resolve(
      environment.KNOWLEDGE_PATH ?? CONFIG_DEFAULTS.knowledgePath
    )
  };
}

loadLocalEnvFile();
export const config = createConfig();

// 在真正需要调用模型的入口确认 DeepSeek API Key 已设置。
export function requireDeepSeekApiKey(currentConfig: AppConfig = config): string {
  const apiKey = currentConfig.deepseek.apiKey;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is required.");
  return apiKey;
}
