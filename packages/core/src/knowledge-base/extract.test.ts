import { describe, expect, test } from "bun:test";
import {
  buildExtractedTextHeader,
  extractText,
  isSupportedKnowledgeBaseMediaType,
  normalizeKnowledgeBaseMediaType,
} from "./extract";

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
