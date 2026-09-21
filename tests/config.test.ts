import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  CONFIG_DEFAULTS,
  createConfig,
  requireDeepSeekApiKey
} from "../src/config.js";

const execFileAsync = promisify(execFile);
const defaults = createConfig({ DEEPSEEK_API_KEY: "test-key" });

assert.deepEqual(defaults.deepseek, {
  apiKey: "test-key",
  model: "deepseek-flash",
  baseUrl: "https://api.deepseek.com",
  reasoningEffort: "high"
});
assert.deepEqual(defaults.agent, {
  maxSteps: 12,
  contextMaxCharacters: 30_000,
  oldToolOutputMaxCharacters: 1_500,
  toolOutputMaxCharacters: 12_000,
  webPort: 3_000,
  webSearchEnabled: true
});
assert.deepEqual(defaults.chroma, {
  host: "127.0.0.1",
  port: 8_000,
  modelPath: path.resolve(CONFIG_DEFAULTS.chromaModelPath),
  dataPath: path.resolve(".myagent/chroma"),
  collection: "myagent_knowledge"
});
assert.equal(defaults.knowledgePath, path.resolve("knowledge"));

const overridden = createConfig({
  DEEPSEEK_API_KEY: "  overridden-key  ",
  DEEPSEEK_MODEL: "custom-model",
  DEEPSEEK_BASE_URL: "https://example.test/v1",
  DEEPSEEK_REASONING_EFFORT: "max",
  AGENT_MAX_STEPS: "7",
  AGENT_CONTEXT_MAX_CHARS: "20000",
  AGENT_OLD_TOOL_OUTPUT_MAX_CHARS: "900",
  AGENT_TOOL_OUTPUT_MAX_CHARS: "6000",
  AGENT_WEB_PORT: "4321",
  AGENT_WEB_SEARCH_ENABLED: "false",
  CHROMA_HOST: "192.0.2.10",
  CHROMA_PORT: "8123",
  CHROMA_MODEL_PATH: "fixtures/model",
  CHROMA_DATA_PATH: "fixtures/chroma",
  CHROMA_COLLECTION: "papers",
  KNOWLEDGE_PATH: "fixtures/knowledge"
});

assert.equal(overridden.deepseek.apiKey, "overridden-key");
assert.equal(overridden.deepseek.model, "custom-model");
assert.equal(overridden.deepseek.baseUrl, "https://example.test/v1");
assert.equal(overridden.deepseek.reasoningEffort, "max");
assert.deepEqual(overridden.agent, {
  maxSteps: 7,
  contextMaxCharacters: 20_000,
  oldToolOutputMaxCharacters: 900,
  toolOutputMaxCharacters: 6_000,
  webPort: 4_321,
  webSearchEnabled: false
});
assert.deepEqual(overridden.chroma, {
  host: "192.0.2.10",
  port: 8_123,
  modelPath: path.resolve("fixtures/model"),
  dataPath: path.resolve("fixtures/chroma"),
  collection: "papers"
});
assert.equal(overridden.knowledgePath, path.resolve("fixtures/knowledge"));

assert.throws(
  () => createConfig({ DEEPSEEK_API_KEY: "test-key", AGENT_MAX_STEPS: "12x" }),
  /AGENT_MAX_STEPS must be a positive integer/
);
assert.throws(
  () =>
    createConfig({
      DEEPSEEK_API_KEY: "test-key",
      DEEPSEEK_REASONING_EFFORT: "medium"
    }),
  /DEEPSEEK_REASONING_EFFORT must be low, high, or max/
);
assert.throws(
  () => createConfig({ DEEPSEEK_API_KEY: "test-key", AGENT_WEB_PORT: "0" }),
  /AGENT_WEB_PORT must be an integer between 1 and 65535/
);
assert.throws(
  () => createConfig({ CHROMA_PORT: "65536" }),
  /CHROMA_PORT must be an integer between 1 and 65535/
);
assert.throws(
  () => createConfig({ AGENT_WEB_SEARCH_ENABLED: "yes" }),
  /AGENT_WEB_SEARCH_ENABLED must be true or false/
);
assert.throws(
  () => requireDeepSeekApiKey(createConfig({})),
  /DEEPSEEK_API_KEY is required/
);

const envDirectory = await mkdtemp(path.join(tmpdir(), "my-agent-config-"));
try {
  await writeFile(
    path.join(envDirectory, ".env"),
    "DEEPSEEK_API_KEY=from-dot-env\nAGENT_MAX_STEPS=9\n",
    "utf8"
  );
  const configModuleUrl = pathToFileURL(path.resolve(".build/src/config.js")).href;
  const childScript = `import { config } from ${JSON.stringify(configModuleUrl)}; console.log(JSON.stringify({ apiKey: config.deepseek.apiKey, maxSteps: config.agent.maxSteps }));`;
  const childEnvironment: NodeJS.ProcessEnv = {};
  if (process.env.SystemRoot) childEnvironment.SystemRoot = process.env.SystemRoot;
  if (process.env.PATH) childEnvironment.PATH = process.env.PATH;
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--input-type=module", "--eval", childScript],
    {
      cwd: envDirectory,
      env: childEnvironment,
      encoding: "utf8"
    }
  );

  assert.deepEqual(JSON.parse(stdout.trim()), {
    apiKey: "from-dot-env",
    maxSteps: 9
  });
} finally {
  await rm(envDirectory, { recursive: true, force: true });
}

console.log("PASS: .env loading, centralized defaults, overrides, and validation work.");
