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
      { data: tinyPngBase64, mediaType: "image/png" },
    ]);

    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([
      { text: "see this", type: "text" },
      { data: tinyPngBase64, mediaType: "image/png", type: "image" },
    ]);
  });

  test("allows image-only message", () => {
    const result = normalizeUserContent("", [
      { data: tinyPngBase64, mediaType: "image/png" },
    ]);

    expect(result).toEqual([
      { data: tinyPngBase64, mediaType: "image/png", type: "image" },
    ]);
  });

  test("returns parts when documents present", () => {
    const result = normalizeUserContent("summarize", undefined, [
      {
        data: "SGVsbG8=",
        filename: "notes.txt",
        mediaType: "text/plain",
      },
    ]);

    expect(result).toEqual([
      { text: "summarize", type: "text" },
      {
        data: "SGVsbG8=",
        filename: "notes.txt",
        mediaType: "text/plain",
        type: "document",
      },
    ]);
  });

  test("allows document-only message", () => {
    const result = normalizeUserContent("", undefined, [
      {
        data: "SGVsbG8=",
        filename: "notes.txt",
        mediaType: "text/plain",
      },
    ]);

    expect(result).toEqual([
      {
        data: "SGVsbG8=",
        filename: "notes.txt",
        mediaType: "text/plain",
        type: "document",
      },
    ]);
  });
});

describe("validateImageAttachments", () => {
  test("rejects unsupported media type", () => {
    expect(() =>
      validateImageAttachments([
        { data: tinyPngBase64, mediaType: "image/bmp" },
      ])
    ).toThrow(NakamaApiError);
  });

  test("rejects oversized image", () => {
    const huge = "A".repeat((6 * 1024 * 1024 * 4) / 3);
    expect(() =>
      validateImageAttachments([{ data: huge, mediaType: "image/png" }])
    ).toThrow(NakamaApiError);
  });
});

describe("validateDocumentAttachments", () => {
  test("rejects unsupported media type", () => {
    expect(() =>
      validateDocumentAttachments([
        {
          data: "YWJj",
          filename: "bad.bin",
          mediaType: "application/octet-stream",
        },
      ])
    ).toThrow(NakamaApiError);
  });

  test("accepts excel attachments under the size limit", () => {
    expect(() =>
      validateDocumentAttachments([
        {
          data: "YWJj",
          filename: "budget.xlsx",
          mediaType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
      ])
    ).not.toThrow();
  });

  test("normalizes excel extension when media type is generic", () => {
    expect(() =>
      validateDocumentAttachments([
        {
          data: "YWJj",
          filename: "budget.xlsx",
          mediaType: "application/octet-stream",
        },
      ])
    ).not.toThrow();
  });

  test("rejects oversized document", () => {
    const huge = "A".repeat((6 * 1024 * 1024 * 4) / 3);
    expect(() =>
      validateDocumentAttachments([
        { data: huge, filename: "big.pdf", mediaType: "application/pdf" },
      ])
    ).toThrow(NakamaApiError);
  });

  test("rejects oversized excel the same way as other documents", () => {
    const huge = "A".repeat((6 * 1024 * 1024 * 4) / 3);
    expect(() =>
      validateDocumentAttachments([
        {
          data: huge,
          filename: "big.xlsx",
          mediaType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
      ])
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
        { text: "line one", type: "text" },
        { data: tinyPngBase64, mediaType: "image/png", type: "image" },
        { text: "line two", type: "text" },
      ])
    ).toBe("line one\nline two");
  });
});

describe("estimateUserContentTokens", () => {
  test("adds fixed tokens per image", () => {
    const tokens = estimateUserContentTokens([
      { text: "hi", type: "text" },
      { data: tinyPngBase64, mediaType: "image/png", type: "image" },
    ]);

    expect(tokens).toBeGreaterThan(1400);
  });
});

describe("stripImagesForCompaction", () => {
  test("replaces image parts with placeholder text", () => {
    const result = stripImagesForCompaction([
      {
        content: [
          { text: "diagram", type: "text" },
          { data: tinyPngBase64, mediaType: "image/png", type: "image" },
        ],
        role: "user",
      },
    ]);

    expect(result[0]).toEqual({
      content: "diagram\n[1 image omitted from summary]",
      role: "user",
    });
  });
});

describe("parseDataUrl", () => {
  test("parses valid data url", () => {
    expect(parseDataUrl(`data:image/png;base64,${tinyPngBase64}`)).toEqual({
      data: tinyPngBase64,
      mediaType: "image/png",
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
        { text: "x", type: "text" },
        { data: tinyPngBase64, mediaType: "image/png", type: "image" },
      ])
    ).toBe(1);
  });
});
