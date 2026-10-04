import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export interface PdfPage {
  pageNumber: number;
  text: string;
}

export interface ParsedPdf {
  pageCount: number;
  pages: PdfPage[];
}

export interface PdfTextItemLike {
  str: string;
  hasEOL?: boolean;
  transform?: number[];
}

// 把 PDF.js 的文本项按行合并为可检索文本。
export function joinPdfTextItems(items: PdfTextItemLike[]): string {
  const lines: string[] = [];
  let currentLine = "";
  let previousY: number | undefined;

  for (const item of items) {
    const text = item.str.replace(/\s+/g, " ").trim();
    const currentY = item.transform?.[5];
    const changedLine =
      previousY !== undefined && currentY !== undefined && Math.abs(currentY - previousY) > 2;

    if (changedLine && currentLine) {
      lines.push(currentLine.trim());
      currentLine = "";
    }

    if (text) currentLine = currentLine ? `${currentLine} ${text}` : text;
    if (item.hasEOL && currentLine) {
      lines.push(currentLine.trim());
      currentLine = "";
    }
    if (currentY !== undefined) previousY = currentY;
  }

  if (currentLine) lines.push(currentLine.trim());
  return lines.filter(Boolean).join("\n");
}

// 使用 PDF.js 从内存中的 PDF 数据逐页提取文本。
export async function parsePdf(data: Uint8Array): Promise<ParsedPdf> {
  if (data.length < 5 || new TextDecoder("ascii").decode(data.slice(0, 5)) !== "%PDF-") {
    throw new Error("The file is not a valid PDF document.");
  }

  const standardFontDataUrl = pathToFileURL(
    `${path.resolve("node_modules/pdfjs-dist/standard_fonts")}${path.sep}`
  ).href;
  const loadingTask = getDocument({ data, standardFontDataUrl, verbosity: 0 });
  const document = await loadingTask.promise;
  const pageCount = document.numPages;
  const pages: PdfPage[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const items: PdfTextItemLike[] = content.items.flatMap((item) =>
        "str" in item
          ? [{ str: item.str, hasEOL: item.hasEOL, transform: [...item.transform] }]
          : []
      );
      pages.push({ pageNumber, text: joinPdfTextItems(items) });
      page.cleanup();
    }
  } finally {
    await loadingTask.destroy();
  }

  return { pageCount, pages };
}

// 从本地路径读取并解析 PDF 文件。
export async function parsePdfFile(filePath: string): Promise<ParsedPdf> {
  return parsePdf(new Uint8Array(await readFile(filePath)));
}
