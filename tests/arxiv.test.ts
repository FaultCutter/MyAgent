import assert from "node:assert/strict";
import { normalizeArxivId, parseArxivFeed, searchArxiv } from "../src/paper.js";

const atom = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/1706.03762v7</id>
    <updated>2023-08-02T00:00:00Z</updated>
    <published>2017-06-12T17:57:34Z</published>
    <title>Attention Is All You Need</title>
    <summary>A sequence transduction model &amp; attention.</summary>
    <author><name>Ashish Vaswani</name></author>
    <author><name>Noam Shazeer</name></author>
    <category term="cs.CL" scheme="http://arxiv.org/schemas/atom"/>
    <link title="pdf" href="http://arxiv.org/pdf/1706.03762v7" rel="related" type="application/pdf"/>
  </entry>
</feed>`;

const parsed = parseArxivFeed(atom);
assert.equal(parsed.length, 1);
assert.deepEqual(parsed[0], {
  id: "1706.03762v7",
  arxivId: "1706.03762",
  title: "Attention Is All You Need",
  summary: "A sequence transduction model & attention.",
  authors: ["Ashish Vaswani", "Noam Shazeer"],
  categories: ["cs.CL"],
  published: "2017-06-12T17:57:34Z",
  updated: "2023-08-02T00:00:00Z",
  abstractUrl: "https://arxiv.org/abs/1706.03762v7",
  pdfUrl: "https://arxiv.org/pdf/1706.03762v7"
});

assert.equal(normalizeArxivId("https://arxiv.org/pdf/1706.03762.pdf"), "1706.03762");
assert.equal(normalizeArxivId("hep-th/9901001v2"), "hep-th/9901001v2");
assert.throws(() => normalizeArxivId("not-an-id"), /Invalid arXiv ID/);

let requestedUrl = "";
// 用固定 Atom 数据模拟 arXiv HTTP 响应，避免测试访问网络。
const fakeFetch = (async (input: string | URL | Request) => {
  requestedUrl = String(input);
  return new Response(atom, { status: 200, headers: { "content-type": "application/atom+xml" } });
}) as typeof fetch;

const searchResults = await searchArxiv("attention", 50, fakeFetch);
assert.equal(searchResults.length, 1);
assert.match(requestedUrl, /max_results=10/);
assert.match(requestedUrl, /search_query=all%3Aattention/);
await assert.rejects(searchArxiv(" ", 5, fakeFetch), /cannot be empty/);

console.log("PASS: arXiv IDs, Atom parsing, and bounded search requests work.");
