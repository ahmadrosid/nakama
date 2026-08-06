import { describe, expect, test } from "bun:test";
import {
  clearDocumentTextParsers,
  getDocumentTextParser,
  providerSupportsNativeDocument,
  registerDocumentTextParser,
  resolveDocumentPartForProvider,
} from "./document-content";

describe("providerSupportsNativeDocument", () => {
  test("anthropic supports pdf and text documents", () => {
    expect(providerSupportsNativeDocument("anthropic", "application/pdf")).toBe(true);
    expect(providerSupportsNativeDocument("anthropic", "text/plain")).toBe(true);
  });

  test("openai supports docx", () => {
    expect(
      providerSupportsNativeDocument(
        "openai",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe(true);
  });

  test("openrouter supports the same native documents as openai", () => {
    expect(providerSupportsNativeDocument("openrouter", "application/pdf")).toBe(true);
    expect(
      providerSupportsNativeDocument(
        "openrouter",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe(true);
  });

  test("cerebras does not advertise native document support", () => {
    expect(providerSupportsNativeDocument("cerebras", "application/pdf")).toBe(false);
    expect(providerSupportsNativeDocument("cerebras", "text/plain")).toBe(false);
    expect(providerSupportsNativeDocument("fireworks", "application/pdf")).toBe(false);
  });

  test("gemini supports pdf and text documents", () => {
    expect(providerSupportsNativeDocument("gemini", "application/pdf")).toBe(true);
    expect(providerSupportsNativeDocument("gemini", "text/plain")).toBe(true);
  });
});

describe("registerDocumentTextParser", () => {
  test("registers and retrieves parser", () => {
    clearDocumentTextParsers();
    const parser = () => "parsed";

    registerDocumentTextParser("application/octet-stream", parser);
    expect(getDocumentTextParser("application/octet-stream")).toBe(parser);

    clearDocumentTextParsers();
  });
});

describe("resolveDocumentPartForProvider", () => {
  test("returns native document part when supported", async () => {
    const result = await resolveDocumentPartForProvider(
      {
        type: "document",
        filename: "report.pdf",
        mediaType: "application/pdf",
        data: "JVBERi0=",
      },
      "anthropic",
    );

    expect(result).toEqual({
      type: "document",
      filename: "report.pdf",
      mediaType: "application/pdf",
      data: "JVBERi0=",
    });
  });

  test("uses registered parser when native support is unavailable", async () => {
    clearDocumentTextParsers();
    registerDocumentTextParser("application/octet-stream", () => "parsed file text");

    const result = await resolveDocumentPartForProvider(
      {
        type: "document",
        filename: "data.bin",
        mediaType: "application/octet-stream",
        data: "YWJj",
      },
      "openai",
    );

    expect(result).toEqual({
      type: "text",
      text: "[File: data.bin]\nparsed file text",
    });

    clearDocumentTextParsers();
  });

  test("throws when no native support and no parser", async () => {
    clearDocumentTextParsers();

    await expect(
      resolveDocumentPartForProvider(
        {
          type: "document",
          filename: "data.bin",
          mediaType: "application/octet-stream",
          data: "YWJj",
        },
        "openai",
      ),
    ).rejects.toThrow('Provider "openai" does not support application/octet-stream');
  });

  test("parses pdf to text for providers without native document support", async () => {
    const pdfBase64 =
      "JVBERi0xLjQKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBvYmo8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PmVuZG9iagozIDAgb2JqPDwvVHlwZS9QYWdlL01lZGlhQm94WzAgMCA2MTIgNzkyXS9QYXJlbnQgMiAwIFIvUmVzb3VyY2VzPDwvRm9udDw8L0YxIDQgMCBSPj4+Pi9Db250ZW50cyA1IDAgUj4+ZW5kb2JqCjQgMCBvYmo8PC9UeXBlL0ZvbnQvU3VidHlwZS9UeXBlMS9CYXNlRm9udC9IZWx2ZXRpY2E+PmVuZG9iago1IDAgb2JqPDwvTGVuZ3RoIDQ0Pj5zdHJlYW0KQlQgL0YxIDI0IFRmIDEwMCA3MDAgVGQgKEhlbGxvKSBUaiBFVAplbmRzdHJlYW0KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDUyIDAwMDAwIG4gCjAwMDAwMDAxMDEgMDAwMDAgbiAKMDAwMDAwMDI0NCAwMDAwMCBuIAowMDAwMDAwMzAxIDAwMDAwIG4gCnRyYWlsZXI8PC9TaXplIDYvUm9vdCAxIDAgUj4+CnN0YXJ0eHJlZgozOTUKJSVFT0YK";

    const result = await resolveDocumentPartForProvider(
      {
        type: "document",
        filename: "report.pdf",
        mediaType: "application/pdf",
        data: pdfBase64,
      },
      "openai_compatible",
    );

    expect(result.type).toBe("text");
    expect(result.text).toStartWith("[File: report.pdf]\n");
    expect(result.text).toContain("Hello");
  });

  test("decodes text/plain for providers without native document support", async () => {
    const text = "alpha beta gamma";
    const data = Buffer.from(text, "utf8").toString("base64");

    const result = await resolveDocumentPartForProvider(
      {
        type: "document",
        filename: "Pasted text (3 words).txt",
        mediaType: "text/plain",
        data,
      },
      "opencode_go",
    );

    expect(result).toEqual({
      type: "text",
      text: "[File: Pasted text (3 words).txt]\nalpha beta gamma",
    });
  });
});
