import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildExtractedTextHeader,
  extractText,
  isSupportedKnowledgeBaseMediaType,
  normalizeKnowledgeBaseMediaType,
} from "./extract";

const SAMPLE_DOCX = readFileSync(
  path.join(import.meta.dir, "..", "__fixtures__", "sample.docx"),
);

describe("knowledge base extract", () => {
  test("normalizes media types from filename extensions", () => {
    expect(normalizeKnowledgeBaseMediaType("application/octet-stream", "notes.md")).toBe(
      "text/markdown",
    );
    expect(normalizeKnowledgeBaseMediaType("text/plain", "data.csv")).toBe("text/csv");
    expect(normalizeKnowledgeBaseMediaType("application/pdf", "report.pdf")).toBe(
      "application/pdf",
    );
  });

  test("supports text and markdown files", () => {
    expect(isSupportedKnowledgeBaseMediaType("text/plain", "notes.txt")).toBe(true);
    expect(isSupportedKnowledgeBaseMediaType("text/markdown", "guide.md")).toBe(true);
    expect(isSupportedKnowledgeBaseMediaType("text/csv", "rows.csv")).toBe(true);
    expect(isSupportedKnowledgeBaseMediaType("application/pdf", "report.pdf")).toBe(true);
    expect(isSupportedKnowledgeBaseMediaType("application/zip", "archive.zip")).toBe(false);
  });

  test("extracts plain text content", async () => {
    const bytes = Buffer.from("alpha\nbeta\n", "utf8");
    const text = await extractText("text/plain", "notes.txt", bytes);
    expect(text).toBe("alpha\nbeta");
  });

  test("accepts docx uploads", () => {
    expect(isSupportedKnowledgeBaseMediaType("application/octet-stream", "laporan.docx")).toBe(
      true,
    );
    expect(normalizeKnowledgeBaseMediaType("application/octet-stream", "laporan.docx")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
  });

  test("extracts docx content as markdown", async () => {
    const text = await extractText("application/octet-stream", "laporan.docx", SAMPLE_DOCX);

    expect(text).toContain("# Laporan Mingguan");
    expect(text).toContain("**teks tebal**");
  });

  test("extracts HTML that was uploaded under a .doc name", async () => {
    const html = Buffer.from("<html><body><h1>Judul</h1></body></html>", "utf8");
    const text = await extractText("application/msword", "lama.doc", html);

    expect(text).toContain("# Judul");
  });

  test("rejects a genuine legacy OLE .doc with an actionable message", async () => {
    const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(extractText("application/msword", "lama.doc", ole)).rejects.toThrow(
      /Convert the file to \.docx/,
    );
  });

  test("builds extracted text headers", () => {
    const header = buildExtractedTextHeader({
      filename: "report.pdf",
      mediaType: "application/pdf",
      uploadedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(header).toContain("# source: report.pdf");
    expect(header).toContain("# mediaType: application/pdf");
    expect(header).toContain("# uploadedAt: 2026-06-13T00:00:00.000Z");
  });
});
