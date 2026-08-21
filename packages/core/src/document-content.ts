import { NakamaApiError } from "./api-error";
import type {
  DocumentAttachment,
  MessageContentPart,
  ProviderName,
} from "./contract";

export type DocumentTextParser = (
  document: DocumentAttachment
) => string | Promise<string>;

const textParsers = new Map<string, DocumentTextParser>();

const DOCX_MEDIA_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MEDIA_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const XLS_MEDIA_TYPE = "application/vnd.ms-excel";
const XLSM_MEDIA_TYPE = "application/vnd.ms-excel.sheet.macroEnabled.12";
const XLSB_MEDIA_TYPE = "application/vnd.ms-excel.sheet.binary.macroEnabled.12";

function decodeDocumentText(data: string): string {
  return Buffer.from(data, "base64").toString("utf8");
}

async function parseWithAnydoc(document: DocumentAttachment): Promise<string> {
  const { convertDocumentBytes } = await import("./anydoc-text");
  const { text, truncated } = await convertDocumentBytes(
    Buffer.from(document.data, "base64"),
    {
      filename: document.filename,
      mediaType: document.mediaType,
    }
  );

  if (!text) {
    return "No extractable text was found. OCR is not supported.";
  }

  if (truncated) {
    return `${text}\n\n[Extracted text was truncated.]`;
  }

  return text;
}

const BUILTIN_DOCUMENT_TEXT_PARSERS: Record<string, DocumentTextParser> = {
  "application/pdf": parseWithAnydoc,
  "text/csv": (document) => decodeDocumentText(document.data),
  "text/markdown": (document) => decodeDocumentText(document.data),
  "text/plain": (document) => decodeDocumentText(document.data),
  [DOCX_MEDIA_TYPE]: parseWithAnydoc,
  [XLSX_MEDIA_TYPE]: parseWithAnydoc,
  [XLS_MEDIA_TYPE]: parseWithAnydoc,
  [XLSM_MEDIA_TYPE]: parseWithAnydoc,
  [XLSB_MEDIA_TYPE]: parseWithAnydoc,
};

const NATIVE_DOCUMENT_MEDIA_TYPES: Record<ProviderName, ReadonlySet<string>> = {
  anthropic: new Set([
    "application/pdf",
    "text/plain",
    "text/csv",
    DOCX_MEDIA_TYPE,
  ]),
  cerebras: new Set<string>(),
  cloudflare: new Set<string>(),
  deepseek: new Set<string>(),
  fireworks: new Set<string>(),
  gemini: new Set([
    "application/pdf",
    "text/plain",
    "text/csv",
    DOCX_MEDIA_TYPE,
  ]),
  minimax: new Set<string>(),
  minimax_cn: new Set<string>(),
  ollama: new Set<string>(),
  openai: new Set([
    "application/pdf",
    "text/plain",
    "text/csv",
    DOCX_MEDIA_TYPE,
  ]),
  openai_compatible: new Set<string>(),
  opencode_go: new Set<string>(),
  openrouter: new Set([
    "application/pdf",
    "text/plain",
    "text/csv",
    DOCX_MEDIA_TYPE,
  ]),
  zhipu: new Set<string>(),
  zhipu_cn: new Set<string>(),
};

export function registerDocumentTextParser(
  mediaType: string,
  parser: DocumentTextParser
): void {
  textParsers.set(mediaType, parser);
}

export function clearDocumentTextParsers(): void {
  textParsers.clear();
}

export function providerSupportsNativeDocument(
  provider: ProviderName,
  mediaType: string
): boolean {
  return NATIVE_DOCUMENT_MEDIA_TYPES[provider].has(mediaType);
}

export function getDocumentTextParser(
  mediaType: string
): DocumentTextParser | undefined {
  return textParsers.get(mediaType);
}

export async function resolveDocumentPartForProvider(
  part: Extract<MessageContentPart, { type: "document" }>,
  provider: ProviderName
): Promise<MessageContentPart> {
  if (providerSupportsNativeDocument(provider, part.mediaType)) {
    return part;
  }

  const parser =
    getDocumentTextParser(part.mediaType) ??
    BUILTIN_DOCUMENT_TEXT_PARSERS[part.mediaType];

  if (parser) {
    const text = await parser({
      data: part.data,
      filename: part.filename,
      mediaType: part.mediaType,
    });

    return {
      text: `[File: ${part.filename}]\n${text}`,
      type: "text",
    };
  }

  throw new NakamaApiError(
    `Provider "${provider}" does not support ${part.mediaType} documents natively. Register a text parser with registerDocumentTextParser().`,
    400
  );
}

export async function resolveUserContentForProvider(
  content: string | MessageContentPart[],
  provider: ProviderName
): Promise<string | MessageContentPart[]> {
  if (typeof content === "string") {
    return content;
  }

  const resolved: MessageContentPart[] = [];

  for (const part of content) {
    if (part.type === "document") {
      resolved.push(await resolveDocumentPartForProvider(part, provider));
      continue;
    }

    resolved.push(part);
  }

  return resolved;
}

export function toAnthropicDocumentBlock(
  part: Extract<MessageContentPart, { type: "document" }>
): Record<string, unknown> {
  return {
    source: {
      data: part.data,
      media_type: part.mediaType,
      type: "base64",
    },
    type: "document",
  };
}

export function toOpenAIResponsesDocumentBlock(
  part: Extract<MessageContentPart, { type: "document" }>,
  toDataUrl: (mediaType: string, base64: string) => string
): Record<string, unknown> {
  return {
    file_data: toDataUrl(part.mediaType, part.data),
    filename: part.filename,
    type: "input_file",
  };
}
