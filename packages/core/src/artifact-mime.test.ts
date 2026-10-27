import { describe, expect, test } from "bun:test";
import {
  artifactCodeLanguage,
  assertHtmlArtifactSize,
  inferArtifactMimeType,
  isDelimitedSpreadsheetFile,
  isHtmlArtifactMimeType,
  isImageArtifactMimeType,
  isMarkdownArtifactMimeType,
  isTextArtifactMimeType,
  isUnknownArtifactMimeType,
  isVideoArtifactMimeType,
  looksLikeUtf8Text,
  MAX_HTML_ARTIFACT_BYTES,
} from "./artifact-mime";

test.each([
  ["page.html", ""],
  ["page.HTM", "text/plain"],
  ["page.xhtml", "application/octet-stream"],
  ["page.bin", "Text/HTML; charset=utf-8"],
])("limits HTML by extension or declared type: %s", (filename, mimeType) => {
  expect(() =>
    assertHtmlArtifactSize(filename, MAX_HTML_ARTIFACT_BYTES, mimeType)
  ).not.toThrow();
  expect(() =>
    assertHtmlArtifactSize(filename, MAX_HTML_ARTIFACT_BYTES + 1, mimeType)
  ).toThrow(expect.objectContaining({ status: 413 }));
});

test("does not impose the HTML limit on other formats", () => {
  expect(() =>
    assertHtmlArtifactSize(
      "movie.mp4",
      MAX_HTML_ARTIFACT_BYTES + 1,
      "video/mp4"
    )
  ).not.toThrow();
});

describe("inferArtifactMimeType", () => {
  test("falls back to binary for unknown or extensionless names", () => {
    expect(inferArtifactMimeType("notes.md")).toBe("text/markdown");
    expect(inferArtifactMimeType("clip.mp4")).toBe("video/mp4");
    expect(inferArtifactMimeType("archive.bin")).toBe(
      "application/octet-stream"
    );
    expect(inferArtifactMimeType("Makefile")).toBe("application/octet-stream");
    expect(inferArtifactMimeType(".gitignore")).toBe(
      "application/octet-stream"
    );
  });
});

describe("resolveArtifactMimeType", () => {});

describe("mime predicates", () => {
  test("classifies markdown, html, text, image, and video", () => {
    expect(isMarkdownArtifactMimeType("text/markdown; charset=utf-8")).toBe(
      true
    );
    expect(isHtmlArtifactMimeType("text/html")).toBe(true);
    expect(isTextArtifactMimeType("text/markdown")).toBe(true);
    expect(isTextArtifactMimeType("application/octet-stream")).toBe(false);
    expect(isTextArtifactMimeType("image/png")).toBe(false);
    expect(isImageArtifactMimeType("image/png")).toBe(true);
    expect(isImageArtifactMimeType("image/jpeg")).toBe(true);
    expect(isImageArtifactMimeType("image/svg+xml")).toBe(false);
    expect(isImageArtifactMimeType("application/pdf")).toBe(false);
    expect(isVideoArtifactMimeType("video/mp4")).toBe(true);
    expect(isVideoArtifactMimeType("video/webm; codecs=vp9")).toBe(true);
    expect(isVideoArtifactMimeType("application/octet-stream")).toBe(false);
    expect(isVideoArtifactMimeType("image/png")).toBe(false);
    expect(isUnknownArtifactMimeType("application/octet-stream")).toBe(true);
    expect(isUnknownArtifactMimeType("text/plain")).toBe(false);
  });

  test("classifies csv and tsv as delimited spreadsheets", () => {
    expect(isDelimitedSpreadsheetFile("sample_customers.csv")).toBe(true);
    expect(isDelimitedSpreadsheetFile("rates.tsv")).toBe(true);
    expect(isDelimitedSpreadsheetFile("data.txt", "text/csv")).toBe(true);
    expect(
      isDelimitedSpreadsheetFile("data.txt", "text/tab-separated-values")
    ).toBe(true);
    expect(isDelimitedSpreadsheetFile("notes.md")).toBe(false);
    expect(isDelimitedSpreadsheetFile("budget.xlsx")).toBe(false);
  });
});

describe("artifactCodeLanguage", () => {
  test("leaves prose-ish text unhighlighted", () => {
    expect(artifactCodeLanguage("app.tsx")).toBe("tsx");
    expect(artifactCodeLanguage("notes.txt")).toBeNull();
    expect(artifactCodeLanguage("report.md")).toBeNull();
    expect(artifactCodeLanguage("rows.csv")).toBeNull();
  });
});

describe("looksLikeUtf8Text", () => {
  const encode = (value: string) => new TextEncoder().encode(value);

  test("rejects payloads with NUL bytes or invalid utf-8", () => {
    expect(
      looksLikeUtf8Text(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01]))
    ).toBe(false);
    expect(looksLikeUtf8Text(new Uint8Array([0xff, 0xfe, 0xfd]))).toBe(false);
  });
});
