import assert from "node:assert/strict";
import {
  enabledToolDefinitions,
  executeTool,
  toolDefinitions
} from "../src/tools.js";
import { parseSearchResults } from "../src/web-search.js";

const fixture = `<?xml version="1.0"?>
<rss><channel>
  <item>
    <title>First &amp; useful result</title>
    <link>https://example.com/first?a=1&amp;b=2</link>
    <description><![CDATA[An <b>example</b> search snippet.]]></description>
  </item>
  <item>
    <title>Second result</title>
    <link>https://example.com/second</link>
    <description>Another result.</description>
  </item>
</channel></rss>`;

const pageFixture = `<!doctype html>
<html>
  <head>
    <title>Paper &amp; Evidence</title>
    <style>body { color: red; }</style>
    <script>window.hidden = "do not expose";</script>
  </head>
  <body>
    <main>
      <h1>Main heading</h1>
      <p>First &amp; second paragraph.</p>
      <h2>Target section</h2>
      <p>The focused evidence appears here.</p>
    </main>
  </body>
</html>`;

assert.deepEqual(parseSearchResults(fixture), [
  {
    title: "First & useful result",
    url: "https://example.com/first?a=1&b=2",
    snippet: "An example search snippet."
  },
  {
    title: "Second result",
    url: "https://example.com/second",
    snippet: "Another result."
  }
]);

assert.equal(
  toolDefinitions.some((tool) => tool.name === "web_search"),
  true,
  "web_search should be available to the model."
);
assert.equal(
  toolDefinitions.some((tool) => tool.name === "fetch_web_page"),
  true,
  "fetch_web_page should be available to read a selected result."
);

assert.equal(
  enabledToolDefinitions(false).some((tool) => tool.name === "web_search"),
  false,
  "web_search should be hidden when the run disables web access."
);
assert.equal(
  enabledToolDefinitions(false).some((tool) => tool.name === "fetch_web_page"),
  false,
  "fetch_web_page should be hidden when the run disables web access."
);
assert.equal(
  enabledToolDefinitions(true).some((tool) => tool.name === "web_search"),
  true,
  "web_search should be available when the run enables web access."
);
assert.equal(
  enabledToolDefinitions(true).some((tool) => tool.name === "fetch_web_page"),
  true,
  "fetch_web_page should be available when the run enables web access."
);

const originalFetch = globalThis.fetch;

try {
  // 用固定 RSS 响应替代真实网络请求，验证工具分发路径。
  globalThis.fetch = async () => new Response(fixture, { status: 200 });
  const output = await executeTool(
    "web_search",
    JSON.stringify({ query: "agent development" }),
    12_000
  );
  const parsed = JSON.parse(output) as { query: string; results: unknown[] };

  assert.equal(parsed.query, "agent development");
  assert.equal(parsed.results.length, 2);

  // 用固定 HTML 响应验证网页正文提取和工具分发，不访问真实网络。
  globalThis.fetch = async () =>
    new Response(pageFixture, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" }
    });
  const pageOutput = await executeTool(
    "fetch_web_page",
    JSON.stringify({ url: "https://example.com/paper" }),
    12_000
  );

  assert.match(pageOutput, /URL: https:\/\/example\.com\/paper/);
  assert.match(pageOutput, /Title: Paper & Evidence/);
  assert.match(pageOutput, /Main heading/);
  assert.match(pageOutput, /First & second paragraph\./);
  assert.doesNotMatch(pageOutput, /window\.hidden|color: red/);

  // 用 find 从同一网页中定位目标段落，避免超长页面依赖命令行二次抓取。
  const focusedPageOutput = await executeTool(
    "fetch_web_page",
    JSON.stringify({
      url: "https://example.com/paper",
      find: "target section"
    }),
    12_000
  );
  assert.match(focusedPageOutput, /Target section/);
  assert.match(focusedPageOutput, /The focused evidence appears here\./);

  await assert.rejects(
    executeTool(
      "fetch_web_page",
      JSON.stringify({ url: "https://example.com/paper", find: "missing heading" })
    ),
    /Text not found in web page: missing heading/
  );

  // PDF 留给后续论文解析能力，当前网页工具应明确拒绝。
  globalThis.fetch = async () =>
    new Response("fake pdf", {
      status: 200,
      headers: { "content-type": "application/pdf" }
    });
  await assert.rejects(
    executeTool(
      "fetch_web_page",
      JSON.stringify({ url: "https://example.com/paper.pdf" })
    ),
    /PDF reading is not implemented yet/
  );

  await assert.rejects(
    executeTool("fetch_web_page", JSON.stringify({ url: "file:///C:/secret.txt" })),
    /only supports http:\/\/ and https:\/\//
  );
} finally {
  globalThis.fetch = originalFetch;
}

console.log("PASS: web search and HTML page fetching are registered, gated, and parsed correctly.");
