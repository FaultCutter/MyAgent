import assert from "node:assert/strict";
import { SYSTEM_PROMPT } from "../src/agent.js";
import { executeTool, toolDefinitions } from "../src/tools.js";

// 按名称读取工具定义，验证模型实际看到的路由说明。
function toolDescription(name: string): string {
  const tool = toolDefinitions.find((candidate) => candidate.name === name);
  assert.ok(tool, `Missing tool definition: ${name}`);
  return tool.description;
}

assert.equal(
  toolDefinitions.some((tool) => tool.name === "run_command"),
  true,
  "run_command should be available for approval."
);

assert.match(SYSTEM_PROMPT, /Preserve the user's requested scope/);
assert.match(SYSTEM_PROMPT, /one authoritative primary source is normally enough/);
assert.match(SYSTEM_PROMPT, /at most one web_search and one or two fetch_web_page calls/);
assert.match(SYSTEM_PROMPT, /For informational questions, answer directly/);
assert.match(toolDescription("knowledge_search"), /do not use for ordinary public documentation/);
assert.match(toolDescription("fetch_web_page"), /Stop researching once/);
assert.match(toolDescription("run_command"), /Never use it instead of web, knowledge, or file tools/);

assert.equal(
  toolDefinitions.some((tool) => tool.name === "knowledge_search"),
  true,
  "knowledge_search should be available for local RAG."
);

assert.match(
  await executeTool(
    "run_command",
    JSON.stringify({ command: "node --version", reason: "Verify the Node.js version" }),
    12_000
  ),
  /stdout:\s+v\d+/
);

assert.match(
  await executeTool(
    "run_command",
    JSON.stringify({ command: "ls", reason: "Verify PowerShell command support" }),
    12_000
  ),
  /package\.json/
);

const limitedOutput = await executeTool(
  "read_file",
  JSON.stringify({ path: "README.md" }),
  160
);
assert.equal(limitedOutput.length, 160, "过长工具结果应严格落在字符预算内");
assert.match(limitedOutput, /^# myAgent/);
assert.match(limitedOutput, /工具输出已裁剪/);

await assert.rejects(
  executeTool("read_file", JSON.stringify({ path: "README.md" }), 0),
  /positive integer/
);

console.log("PASS: tool routing guidance, command execution, and output budgets work.");
