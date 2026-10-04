import assert from "node:assert/strict";
import { joinPdfTextItems, parsePdf } from "../src/pdf.js";

// 生成一个只含单页文本的最小 PDF，用于验证真实解析链路。
function buildMinimalPdf(): Uint8Array {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Length 47 >>\nstream\nBT /F1 24 Tf 72 720 Td (Hello Paper) Tj ET\nendstream"
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, "ascii"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, "ascii");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, "ascii"));
}

assert.equal(
  joinPdfTextItems([
    { str: "First", transform: [1, 0, 0, 1, 0, 100] },
    { str: "line", hasEOL: true, transform: [1, 0, 0, 1, 30, 100] },
    { str: "Second", transform: [1, 0, 0, 1, 0, 80] }
  ]),
  "First line\nSecond"
);

const parsed = await parsePdf(buildMinimalPdf());
assert.equal(parsed.pageCount, 1);
assert.match(parsed.pages[0]?.text ?? "", /Hello Paper/);
await assert.rejects(parsePdf(new Uint8Array([1, 2, 3])), /not a valid PDF/);

console.log("PASS: PDF text joining and real one-page parsing work.");
