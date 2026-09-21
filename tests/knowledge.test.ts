import assert from "node:assert/strict";
import { hashKnowledgeChunks, splitKnowledgeText } from "../src/knowledge.js";

const source = "guide.md";
const text = `# myAgent

myAgent is a learning-oriented TypeScript agent.

## Knowledge

Local knowledge is retrieved before the model writes its answer.`;
const chunks = splitKnowledgeText(source, text, 80, 10);

assert.equal(chunks.length, 2);
assert.equal(chunks[0]?.id, "guide.md#0001");
assert.equal(chunks[1]?.source, source);
assert.match(chunks[1]?.text ?? "", /Local knowledge/);
assert.equal(hashKnowledgeChunks(chunks), hashKnowledgeChunks(chunks));
assert.notEqual(
  hashKnowledgeChunks(chunks),
  hashKnowledgeChunks(splitKnowledgeText(source, `${text}\nchanged`, 80, 10))
);

console.log("PASS: knowledge documents are chunked and hashed deterministically.");
