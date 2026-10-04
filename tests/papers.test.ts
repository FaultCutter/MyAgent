import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ArxivPaper } from "../src/paper.js";
import { chunkPaperPages, savePaperGuide } from "../src/paper.js";

const paper: ArxivPaper = {
  id: "1706.03762v7",
  arxivId: "1706.03762",
  title: "Attention Is All You Need",
  summary: "Transformer paper",
  authors: ["A. Author"],
  categories: ["cs.CL"],
  published: "2017-06-12T17:57:34Z",
  updated: "2023-08-02T00:00:00Z",
  abstractUrl: "https://arxiv.org/abs/1706.03762v7",
  pdfUrl: "https://arxiv.org/pdf/1706.03762v7"
};

const chunks = chunkPaperPages(
  paper,
  [
    { pageNumber: 1, text: "Abstract\n\n" + "attention ".repeat(20) },
    { pageNumber: 2, text: "Methods\n\nScaled dot product attention." }
  ],
  80,
  10
);

assert.ok(chunks.length >= 3);
assert.equal(chunks[0]?.paperId, "1706.03762v7");
assert.equal(chunks[0]?.page, 1);
assert.match(chunks[0]?.id ?? "", /^1706\.03762v7#p0001-c0001$/);
assert.equal(chunks.at(-1)?.page, 2);
assert.equal(new Set(chunks.map((chunk) => chunk.id)).size, chunks.length);

const temporaryLibrary = await mkdtemp(path.join(tmpdir(), "myagent-paper-guide-"));
try {
  const paperDirectory = path.join(temporaryLibrary, paper.id);
  await mkdir(paperDirectory);
  await writeFile(
    path.join(paperDirectory, "metadata.json"),
    JSON.stringify({ paper, importedAt: "2026-01-01", pageCount: 2, chunks: 3 }),
    "utf8"
  );

  const firstGuide = await savePaperGuide(paper.id, "# 第一版\n\n有证据的导读", temporaryLibrary);
  const secondGuide = await savePaperGuide(paper.id, "# 第二版", temporaryLibrary);
  assert.equal(path.basename(firstGuide), "guide.md");
  assert.equal(path.basename(secondGuide), "guide-2.md");
  assert.equal(await readFile(firstGuide, "utf8"), "# 第一版\n\n有证据的导读\n");
  assert.equal(await readFile(secondGuide, "utf8"), "# 第二版\n");
  await assert.rejects(
    savePaperGuide("2401.00001", "# 未导入", temporaryLibrary),
    /not imported/
  );
  await assert.rejects(savePaperGuide(paper.id, " ", temporaryLibrary), /cannot be empty/);
} finally {
  await rm(temporaryLibrary, { recursive: true, force: true });
}

console.log("PASS: paper chunks and non-overwriting Markdown guides preserve paper identity.");
