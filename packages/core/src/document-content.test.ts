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
});
