import { describe, expect, test } from "bun:test";
import {
  buildExtractedTextHeader,
  extractText,
  isSupportedKnowledgeBaseMediaType,
  normalizeKnowledgeBaseMediaType,
} from "./extract";

describe("knowledge base extract", () => {
  test("normalizes media types from filename extensions", () => {
    expect(
      normalizeKnowledgeBaseMediaType("application/octet-stream", "notes.md")
    ).toBe("text/markdown");
    expect(normalizeKnowledgeBaseMediaType("text/plain", "data.csv")).toBe(
      "text/csv"
    );
    expect(
      normalizeKnowledgeBaseMediaType("application/pdf", "report.pdf")
    ).toBe("application/pdf");
  });

  test("supports text and markdown files", () => {
    expect(isSupportedKnowledgeBaseMediaType("text/plain", "notes.txt")).toBe(
      true
    );
    expect(isSupportedKnowledgeBaseMediaType("text/markdown", "guide.md")).toBe(
      true
    );
    expect(isSupportedKnowledgeBaseMediaType("text/csv", "rows.csv")).toBe(
      true
    );
    expect(
      isSupportedKnowledgeBaseMediaType("application/pdf", "report.pdf")
    ).toBe(true);
    expect(
      isSupportedKnowledgeBaseMediaType("application/zip", "archive.zip")
    ).toBe(false);
  });

  test("extracts plain text content", async () => {
    const bytes = Buffer.from("alpha\nbeta\n", "utf8");
    const text = await extractText("text/plain", "notes.txt", bytes);
    expect(text).toBe("alpha\nbeta");
  });

  test("accepts docx uploads", () => {
    expect(
      isSupportedKnowledgeBaseMediaType(
        "application/octet-stream",
        "laporan.docx"
      )
    ).toBe(true);
    expect(
      normalizeKnowledgeBaseMediaType(
        "application/octet-stream",
        "laporan.docx"
      )
    ).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
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

test("knowledge extraction accepts 20 MiB and rejects one byte more", async () => {
  const limit = 20 * 1024 * 1024;
  expect(
    (await extractText("text/plain", "large.txt", Buffer.alloc(limit, "a")))
      .length
  ).toBe(limit);
  await expect(
    extractText("text/plain", "large.txt", Buffer.alloc(limit + 1))
  ).rejects.toThrow();
});
