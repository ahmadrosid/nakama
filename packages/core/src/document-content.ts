import type { DocumentAttachment, MessageContentPart, ProviderName } from "./contract";
import { TinyClawApiError } from "./api-error";

export type DocumentTextParser = (
  document: DocumentAttachment,
) => string | Promise<string>;

const textParsers = new Map<string, DocumentTextParser>();

const NATIVE_DOCUMENT_MEDIA_TYPES: Record<ProviderName, ReadonlySet<string>> = {
  anthropic: new Set([
    "application/pdf",
    "text/plain",
    "text/csv",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ]),
  openai: new Set([
    "application/pdf",
    "text/plain",
    "text/csv",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ]),
  openrouter: new Set([
    "application/pdf",
    "text/plain",
    "text/csv",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ]),
  gemini: new Set([
    "application/pdf",
    "text/plain",
    "text/csv",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ]),
  openai_compatible: new Set<string>(),
  opencode_go: new Set<string>(),
};

export function registerDocumentTextParser(
  mediaType: string,
  parser: DocumentTextParser,
): void {
  textParsers.set(mediaType, parser);
}

export function clearDocumentTextParsers(): void {
  textParsers.clear();
}

export function providerSupportsNativeDocument(
  provider: ProviderName,
  mediaType: string,
): boolean {
  return NATIVE_DOCUMENT_MEDIA_TYPES[provider].has(mediaType);
}

export function getDocumentTextParser(
  mediaType: string,
): DocumentTextParser | undefined {
  return textParsers.get(mediaType);
}

export async function resolveDocumentPartForProvider(
  part: Extract<MessageContentPart, { type: "document" }>,
  provider: ProviderName,
): Promise<MessageContentPart> {
  if (providerSupportsNativeDocument(provider, part.mediaType)) {
    return part;
  }

  const parser = getDocumentTextParser(part.mediaType);

  if (parser) {
    const text = await parser({
      filename: part.filename,
      mediaType: part.mediaType,
      data: part.data,
    });

    return {
      type: "text",
      text: `[File: ${part.filename}]\n${text}`,
    };
  }

  throw new TinyClawApiError(
    `Provider "${provider}" does not support ${part.mediaType} documents natively. Register a text parser with registerDocumentTextParser().`,
    400,
  );
}

export async function resolveUserContentForProvider(
  content: string | MessageContentPart[],
  provider: ProviderName,
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
  part: Extract<MessageContentPart, { type: "document" }>,
): Record<string, unknown> {
  return {
    type: "document",
    source: {
      type: "base64",
      media_type: part.mediaType,
      data: part.data,
    },
  };
}

export function toOpenAIResponsesDocumentBlock(
  part: Extract<MessageContentPart, { type: "document" }>,
  toDataUrl: (mediaType: string, base64: string) => string,
): Record<string, unknown> {
  return {
    type: "input_file",
    filename: part.filename,
    file_data: toDataUrl(part.mediaType, part.data),
  };
}
