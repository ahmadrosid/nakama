import { describe, expect, test } from "bun:test";
import { NakamaApiError } from "./api-error";
import {
  countUserImages,
  estimateUserContentTokens,
  getUserMessageText,
  normalizeUserContent,
  parseDataUrl,
  stripImagesForCompaction,
  validateCombinedAttachmentCount,
  validateDocumentAttachments,
  validateImageAttachments,
} from "./message-content";

const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("normalizeUserContent", () => {
  test("returns parts when images present", () => {
    const result = normalizeUserContent("see this", [
      { mediaType: "image/png", data: tinyPngBase64 },
    ]);

    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([
      { type: "text", text: "see this" },
      { type: "image", mediaType: "image/png", data: tinyPngBase64 },
    ]);
  });

  test("allows image-only message", () => {
    const result = normalizeUserContent("", [
      { mediaType: "image/png", data: tinyPngBase64 },
    ]);

    expect(result).toEqual([
      { type: "image", mediaType: "image/png", data: tinyPngBase64 },
    ]);
  });

  test("returns parts when documents present", () => {
    const result = normalizeUserContent("summarize", undefined, [
      {
        filename: "notes.txt",
        mediaType: "text/plain",
        data: "SGVsbG8=",
      },
    ]);

    expect(result).toEqual([
      { type: "text", text: "summarize" },
      {
        type: "document",
        filename: "notes.txt",
        mediaType: "text/plain",
        data: "SGVsbG8=",
      },
    ]);
  });

  test("allows document-only message", () => {
    const result = normalizeUserContent("", undefined, [
      {
        filename: "notes.txt",
        mediaType: "text/plain",
        data: "SGVsbG8=",
      },
    ]);

    expect(result).toEqual([
      {
        type: "document",
        filename: "notes.txt",
        mediaType: "text/plain",
        data: "SGVsbG8=",
      },
    ]);
  });
});

describe("validateImageAttachments", () => {
  test("rejects unsupported media type", () => {
    expect(() =>
      validateImageAttachments([{ mediaType: "image/bmp", data: tinyPngBase64 }]),
    ).toThrow(NakamaApiError);
  });

  test("rejects oversized image", () => {
    const huge = "A".repeat((6 * 1024 * 1024 * 4) / 3);
    expect(() =>
      validateImageAttachments([{ mediaType: "image/png", data: huge }]),
    ).toThrow(NakamaApiError);
  });
});

describe("validateDocumentAttachments", () => {
  test("rejects unsupported media type", () => {
    expect(() =>
      validateDocumentAttachments([
        { filename: "bad.bin", mediaType: "application/octet-stream", data: "YWJj" },
      ]),
    ).toThrow(NakamaApiError);
  });

  test("rejects oversized document", () => {
    const huge = "A".repeat((6 * 1024 * 1024 * 4) / 3);
    expect(() =>
      validateDocumentAttachments([
        { filename: "big.pdf", mediaType: "application/pdf", data: huge },
      ]),
    ).toThrow(NakamaApiError);
  });
});

describe("validateCombinedAttachmentCount", () => {
  test("rejects more than five attachments total", () => {
    expect(() => validateCombinedAttachmentCount(3, 3)).toThrow(NakamaApiError);
  });
});

describe("getUserMessageText", () => {
  test("extracts text from parts", () => {
    expect(
      getUserMessageText([
        { type: "text", text: "line one" },
        { type: "image", mediaType: "image/png", data: tinyPngBase64 },
        { type: "text", text: "line two" },
      ]),
    ).toBe("line one\nline two");
  });
});

describe("estimateUserContentTokens", () => {
  test("adds fixed tokens per image", () => {
    const tokens = estimateUserContentTokens([
      { type: "text", text: "hi" },
      { type: "image", mediaType: "image/png", data: tinyPngBase64 },
    ]);

    expect(tokens).toBeGreaterThan(1_400);
  });
});

describe("stripImagesForCompaction", () => {
  test("replaces image parts with placeholder text", () => {
    const result = stripImagesForCompaction([
      {
        role: "user",
        content: [
          { type: "text", text: "diagram" },
          { type: "image", mediaType: "image/png", data: tinyPngBase64 },
        ],
      },
    ]);

    expect(result[0]).toEqual({
      role: "user",
      content: "diagram\n[1 image omitted from summary]",
    });
  });
});

describe("parseDataUrl", () => {
  test("parses valid data url", () => {
    expect(parseDataUrl(`data:image/png;base64,${tinyPngBase64}`)).toEqual({
      mediaType: "image/png",
      data: tinyPngBase64,
    });
  });

  test("returns null for invalid url", () => {
    expect(parseDataUrl("not-a-data-url")).toBeNull();
  });
});

describe("countUserImages", () => {
  test("counts image parts", () => {
    expect(
      countUserImages([
        { type: "text", text: "x" },
        { type: "image", mediaType: "image/png", data: tinyPngBase64 },
      ]),
    ).toBe(1);
  });
});
