import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { convertDocxToMarkdown, extractDocxText } from "./docx-text";

const SAMPLE_DOCX = readFileSync(
  path.join(import.meta.dir, "__fixtures__", "sample.docx")
);

test("extracts plain text from a docx", async () => {
  const text = await extractDocxText(SAMPLE_DOCX);

  expect(text).toContain("Laporan Mingguan");
  expect(text).not.toContain("<");
});

test("rejects a genuine legacy OLE .doc payload", async () => {
  const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  expect(convertDocxToMarkdown(ole)).rejects.toThrow(
    /Convert the file to \.docx/
  );
});
