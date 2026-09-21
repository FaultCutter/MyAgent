export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

const SEARCH_ENDPOINT = "https://www.bing.com/search";
const MAX_RESULTS = 5;

// 解码搜索结果中的常见 XML 实体。
function decodeXml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// 读取一个 RSS item 中指定标签的文本。
function readTag(item: string, tag: string): string {
  const match = item.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  const value = match?.[1] ?? "";
  return decodeXml(value.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim());
}

// 删除摘要中的 HTML 标签并整理空白。
function cleanSnippet(value: string): string {
  return decodeXml(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

// 把 Bing RSS 文本解析为统一的搜索结果。
export function parseSearchResults(xml: string): WebSearchResult[] {
  const results: WebSearchResult[] = [];

  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const item = match[1] ?? "";
    const title = readTag(item, "title");
    const url = readTag(item, "link");
    const snippet = cleanSnippet(readTag(item, "description"));

    if (title && url) {
      results.push({ title, url, snippet });
    }

    if (results.length >= MAX_RESULTS) break;
  }

  return results;
}

// 通过无需 API Key 的公开 RSS 入口执行一次网页搜索。
export async function searchWeb(query: string): Promise<WebSearchResult[]> {
  const url = new URL(SEARCH_ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "rss");

  const response = await fetch(url, {
    headers: {
      Accept: "application/rss+xml, application/xml, text/xml",
      "User-Agent": "myAgent-learning/0.1"
    },
    signal: AbortSignal.timeout(15_000)
  });

  if (!response.ok) {
    throw new Error(`Web search failed with HTTP ${response.status}.`);
  }

  return parseSearchResults(await response.text());
}
