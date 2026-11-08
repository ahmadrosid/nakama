import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { convertDocxToMarkdown } from "./docx-text";

const SAMPLE_DOCX = readFileSync(
  path.join(import.meta.dir, "__fixtures__", "sample.docx")
);

test("rejects a genuine legacy OLE .doc payload", async () => {
  const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  expect(convertDocxToMarkdown(ole)).rejects.toThrow(
    /Convert the file to \.docx/
  );
});

test("reads bare WordprocessingML paragraphs and headings", async () => {
  const xml = [
    '<w:document xmlns:w="x"><w:body>',
    '<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Title</w:t></w:r></w:p>',
    "<w:p/>",
    '<w:p><w:r><w:t xml:space="preserve">Fish &amp; </w:t><w:tab/><w:t>chips</w:t></w:r></w:p>',
    "</w:body></w:document>",
  ].join("");

  expect(await convertDocxToMarkdown(Buffer.from(xml))).toBe(
    "## Title\n\nFish & chips"
  );
});

test("bare WordprocessingML without close tags stays fast", async () => {
  const xml = `<w:document>${"<w:p><w:t>".repeat(50_000)}`;
  const started = performance.now();

  expect(await convertDocxToMarkdown(Buffer.from(xml))).toBe("");
  expect(performance.now() - started).toBeLessThan(1000);
});
