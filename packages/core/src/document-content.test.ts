import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  clearDocumentTextParsers,
  getDocumentTextParser,
  providerSupportsNativeDocument,
  registerDocumentTextParser,
  resolveDocumentPartForProvider,
} from "./document-content";

const FIXTURES = join(import.meta.dir, "__fixtures__");
const SAMPLE_PDF_B64 = readFileSync(join(FIXTURES, "sample.pdf")).toString("base64");
const SAMPLE_DOCX_B64 = readFileSync(join(FIXTURES, "sample.docx")).toString("base64");
const SAMPLE_XLSX_B64 = readFileSync(join(FIXTURES, "sample.xlsx")).toString("base64");

const DOCX_MEDIA_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MEDIA_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

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
    const result = await resolveDocumentPartForProvider(
      {
        type: "document",
        filename: "report.pdf",
        mediaType: "application/pdf",
        data: SAMPLE_PDF_B64,
      },
      "openai_compatible",
    );

    expect(result.type).toBe("text");
    expect(result.text).toStartWith("[File: report.pdf]\n");
    expect(result.text.toLowerCase()).toContain("dummy");
  });

  test("parses docx to text for providers without native document support", async () => {
    const result = await resolveDocumentPartForProvider(
      {
        type: "document",
        filename: "notes.docx",
        mediaType: DOCX_MEDIA_TYPE,
        data: SAMPLE_DOCX_B64,
      },
      "cerebras",
    );

    expect(result.type).toBe("text");
    expect(result.text).toStartWith("[File: notes.docx]\n");
    expect(result.text).toContain("Laporan");
  });

  test("always converts excel to text even for native-capable providers", async () => {
    const result = await resolveDocumentPartForProvider(
      {
        type: "document",
        filename: "budget.xlsx",
        mediaType: XLSX_MEDIA_TYPE,
        data: SAMPLE_XLSX_B64,
      },
      "anthropic",
    );

    expect(result.type).toBe("text");
    expect(result.text).toStartWith("[File: budget.xlsx]\n");
    expect(result.text).toContain("Widget");
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
