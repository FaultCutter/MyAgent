export interface WebPageContent {
  url: string;
  title: string;
  contentType: string;
  content: string;
}

const MAX_DOWNLOAD_BYTES = 2_000_000;
const FOCUSED_CONTENT_CHARACTERS = 6_000;

// 解码网页正文中常见的 HTML 实体。
function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (entity, code: string) => {
      const codePoint = Number(code);
      return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
    })
    .replace(/&#x([0-9a-f]+);/gi, (entity, code: string) => {
      const codePoint = Number.parseInt(code, 16);
      return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&amp;/gi, "&");
}

// 合并行内空白，同时保留可供模型识别的段落边界。
function normalizeText(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

// 从 HTML 标题标签中提取页面标题。
function extractTitle(html: string): string {
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  return normalizeText(decodeHtmlEntities(title.replace(/<[^>]+>/g, " ")));
}

// 删除不可见标签并把基础 HTML 结构转换成纯文本段落。
function htmlToText(html: string): string {
  const withoutInvisibleContent = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const withLineBreaks = withoutInvisibleContent
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(
      /<\/?(article|aside|blockquote|div|h[1-6]|li|main|ol|p|pre|section|table|tr|ul)\b[^>]*>/gi,
      "\n"
    );

  return normalizeText(decodeHtmlEntities(withLineBreaks.replace(/<[^>]+>/g, " ")));
}

// 校验网页地址，只接受可由 HTTP fetch 读取的 URL。
function parseWebUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid web page URL: ${value}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("fetch_web_page only supports http:// and https:// URLs.");
  }

  return url;
}

// 围绕关键词命中位置截取正文，便于模型阅读超长网页的相关段落。
function focusContent(content: string, find: string): string {
  const keyword = find.trim();
  if (!keyword) throw new Error("fetch_web_page find must not be empty.");

  const matchIndex = content.toLowerCase().indexOf(keyword.toLowerCase());
  if (matchIndex < 0) {
    throw new Error(`Text not found in web page: ${keyword}`);
  }

  const beforeCharacters = Math.min(1_000, matchIndex);
  const start = matchIndex - beforeCharacters;
  const end = Math.min(content.length, start + FOCUSED_CONTENT_CHARACTERS);
  const prefix = start > 0 ? "[Earlier page content omitted]\n" : "";
  const suffix = end < content.length ? "\n[Later page content omitted]" : "";

  return `${prefix}${content.slice(start, end)}${suffix}`;
}

// 下载一个公开网页并提取适合模型阅读的纯文本正文。
export async function fetchWebPage(value: string, find?: string): Promise<WebPageContent> {
  const requestedUrl = parseWebUrl(value);
  const response = await fetch(requestedUrl, {
    redirect: "follow",
    headers: {
      Accept: "text/html, application/xhtml+xml, text/plain;q=0.9",
      "User-Agent": "myAgent-learning/0.1"
    },
    signal: AbortSignal.timeout(15_000)
  });

  if (!response.ok) {
    throw new Error(`Web page fetch failed with HTTP ${response.status}.`);
  }

  const contentType = (response.headers.get("content-type") ?? "text/html")
    .split(";", 1)[0]!
    .trim()
    .toLowerCase();
  const isTextContent =
    contentType.startsWith("text/") ||
    contentType === "application/xhtml+xml" ||
    contentType === "application/xml";

  if (!isTextContent) {
    throw new Error(
      `Unsupported web page content type: ${contentType || "unknown"}. PDF reading is not implemented yet.`
    );
  }

  const declaredBytes = Number.parseInt(response.headers.get("content-length") ?? "0", 10);
  if (declaredBytes > MAX_DOWNLOAD_BYTES) {
    throw new Error(`Web page is larger than ${MAX_DOWNLOAD_BYTES} bytes.`);
  }

  const source = await response.text();
  if (Buffer.byteLength(source, "utf8") > MAX_DOWNLOAD_BYTES) {
    throw new Error(`Web page is larger than ${MAX_DOWNLOAD_BYTES} bytes.`);
  }

  const isHtml = contentType === "text/html" || contentType === "application/xhtml+xml";
  const fullContent = isHtml ? htmlToText(source) : normalizeText(source);
  const content = find === undefined ? fullContent : focusContent(fullContent, find);
  if (!content) {
    throw new Error("Web page contained no readable text.");
  }

  return {
    url: response.url || requestedUrl.toString(),
    title: isHtml ? extractTitle(source) : "",
    contentType,
    content
  };
}
