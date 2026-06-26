import type {
  ChatMessage,
  DocumentAttachment,
  ImageAttachment,
  MessageContentPart,
  ProviderName,
} from "./contract";
import { TinyClawApiError } from "./api-error";
import {
  resolveUserContentForProvider,
  toAnthropicDocumentBlock,
  toOpenAIResponsesDocumentBlock,
} from "./document-content";

export const MAX_ATTACHMENTS_PER_MESSAGE = 5;
export const MAX_IMAGES_PER_MESSAGE = MAX_ATTACHMENTS_PER_MESSAGE;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const TOKENS_PER_IMAGE_ESTIMATE = 1_500;
export const TOKENS_PER_DOCUMENT_ESTIMATE = 2_000;

const ALLOWED_IMAGE_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

const ALLOWED_DOCUMENT_MEDIA_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/csv",
]);

const DOCUMENT_EXTENSION_MEDIA_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".csv": "text/csv",
  ".txt": "text/plain",
};

export function isMessageContentPartArray(
  content: string | MessageContentPart[],
): content is MessageContentPart[] {
  return Array.isArray(content);
}

export function normalizeUserContent(
  message: string,
  images?: ImageAttachment[],
  documents?: DocumentAttachment[],
): string | MessageContentPart[] {
  const hasImages = Boolean(images?.length);
  const hasDocuments = Boolean(documents?.length);

  if (!hasImages && !hasDocuments) {
    return message;
  }

  if (hasImages) {
    validateImageAttachments(images!);
  }

  if (hasDocuments) {
    validateDocumentAttachments(documents!);
  }

  validateCombinedAttachmentCount(images?.length ?? 0, documents?.length ?? 0);

  const parts: MessageContentPart[] = [];

  if (message.trim()) {
    parts.push({ type: "text", text: message });
  }

  for (const image of images ?? []) {
    parts.push({
      type: "image",
      mediaType: image.mediaType,
      data: image.data,
    });
  }

  for (const document of documents ?? []) {
    parts.push({
      type: "document",
      filename: document.filename,
      mediaType: document.mediaType,
      data: document.data,
    });
  }

  if (parts.length === 0) {
    throw new TinyClawApiError(
      "Message must include text or at least one attachment.",
      400,
    );
  }

  return parts;
}

export function validateCombinedAttachmentCount(
  imageCount: number,
  documentCount: number,
): void {
  const total = imageCount + documentCount;

  if (total > MAX_ATTACHMENTS_PER_MESSAGE) {
    throw new TinyClawApiError(
      `At most ${MAX_ATTACHMENTS_PER_MESSAGE} attachments per message.`,
      400,
    );
  }
}

export function validateImageAttachments(images: ImageAttachment[]): void {
  if (images.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    throw new TinyClawApiError(
      `At most ${MAX_ATTACHMENTS_PER_MESSAGE} images per message.`,
      400,
    );
  }

  for (const image of images) {
    if (!ALLOWED_IMAGE_MEDIA_TYPES.has(image.mediaType)) {
      throw new TinyClawApiError(
        `Unsupported image type: ${image.mediaType}. Allowed: jpeg, png, gif, webp.`,
        400,
      );
    }

    validateAttachmentBytes(image.data, MAX_IMAGE_BYTES, "image");
  }
}

export function validateDocumentAttachments(documents: DocumentAttachment[]): void {
  if (documents.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    throw new TinyClawApiError(
      `At most ${MAX_ATTACHMENTS_PER_MESSAGE} documents per message.`,
      400,
    );
  }

  for (const document of documents) {
    const filename = document.filename.trim();

    if (!filename) {
      throw new TinyClawApiError("Document filename must not be empty.", 400);
    }

    const mediaType = normalizeDocumentMediaType(document.mediaType, filename);

    if (!ALLOWED_DOCUMENT_MEDIA_TYPES.has(mediaType)) {
      throw new TinyClawApiError(
        `Unsupported document type: ${document.mediaType}. Allowed: pdf, docx, csv, txt.`,
        400,
      );
    }

    validateAttachmentBytes(document.data, MAX_DOCUMENT_BYTES, "document");
  }
}

export function normalizeDocumentMediaType(mediaType: string, filename: string): string {
  const trimmed = mediaType.trim().toLowerCase();

  if (ALLOWED_DOCUMENT_MEDIA_TYPES.has(trimmed)) {
    return trimmed;
  }

  const extension = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  return DOCUMENT_EXTENSION_MEDIA_TYPES[extension] ?? trimmed;
}

function validateAttachmentBytes(data: string, maxBytes: number, label: string): void {
  const raw = data.trim();

  if (!raw) {
    throw new TinyClawApiError(`${label} data must not be empty.`, 400);
  }

  const base64 = raw.includes(",") ? (raw.split(",")[1] ?? "") : raw;
  const byteLength = estimateBase64DecodedLength(base64);

  if (byteLength > maxBytes) {
    throw new TinyClawApiError(
      `Each ${label} must be at most ${maxBytes / (1024 * 1024)} MB.`,
      400,
    );
  }
}

function estimateBase64DecodedLength(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

export function getUserMessageText(content: string | MessageContentPart[]): string {
  if (typeof content === "string") {
    return content;
  }

  return content
    .filter((part): part is Extract<MessageContentPart, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

export function countUserImages(content: string | MessageContentPart[]): number {
  if (typeof content === "string") {
    return 0;
  }

  return content.filter((part) => part.type === "image" || part.type === "image_ref").length;
}

export function countUserDocuments(content: string | MessageContentPart[]): number {
  if (typeof content === "string") {
    return 0;
  }

  return content.filter((part) => part.type === "document" || part.type === "document_ref").length;
}

export function messageContentHasImages(content: string | MessageContentPart[]): boolean {
  return countUserImages(content) > 0;
}

export function messageContentHasDocuments(content: string | MessageContentPart[]): boolean {
  return countUserDocuments(content) > 0;
}

export function messagesIncludeUserImages(messages: readonly ChatMessage[]): boolean {
  return messages.some(
    (message) => message.role === "user" && messageContentHasImages(message.content),
  );
}

export function messagesIncludeUserDocuments(messages: readonly ChatMessage[]): boolean {
  return messages.some(
    (message) => message.role === "user" && messageContentHasDocuments(message.content),
  );
}

export function estimateUserContentTokens(content: string | MessageContentPart[]): number {
  const text = getUserMessageText(content);
  const textTokens = Math.ceil(text.length / 4);
  const imageTokens = countUserImages(content) * TOKENS_PER_IMAGE_ESTIMATE;
  const documentTokens = countUserDocuments(content) * TOKENS_PER_DOCUMENT_ESTIMATE;
  return textTokens + imageTokens + documentTokens;
}

export function stripImagesForCompaction(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages.map((message) => {
    if (message.role !== "user" || typeof message.content === "string") {
      return message;
    }

    const text = getUserMessageText(message.content);
    const imageCount = countUserImages(message.content);
    const documentCount = countUserDocuments(message.content);
    const suffixParts: string[] = [];

    if (imageCount > 0) {
      suffixParts.push(
        `[${imageCount} image${imageCount === 1 ? "" : "s"} omitted from summary]`,
      );
    }

    if (documentCount > 0) {
      suffixParts.push(
        `[${documentCount} document${documentCount === 1 ? "" : "s"} omitted from summary]`,
      );
    }

    const suffix = suffixParts.length > 0 ? `\n${suffixParts.join("\n")}` : "";

    return {
      role: "user",
      content: `${text}${suffix}`.trim() || "[attachment]",
    };
  });
}

export function parseDataUrl(dataUrl: string): ImageAttachment | null {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl.trim());

  if (!match) {
    return null;
  }

  return {
    mediaType: match[1]!,
    data: match[2]!,
  };
}

export function parseDocumentDataUrl(
  dataUrl: string,
  filename: string,
): DocumentAttachment | null {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl.trim());

  if (!match) {
    return null;
  }

  const mediaType = normalizeDocumentMediaType(match[1]!, filename);

  return {
    filename,
    mediaType,
    data: match[2]!,
  };
}

export function toDataUrl(mediaType: string, base64: string): string {
  return `data:${mediaType};base64,${base64}`;
}

export function imageAttachmentFromBase64(
  mediaType: string,
  base64: string,
): ImageAttachment {
  const data = base64.includes(",") ? (base64.split(",")[1] ?? base64) : base64;
  return { mediaType, data };
}

export function documentAttachmentFromBase64(
  filename: string,
  mediaType: string,
  base64: string,
): DocumentAttachment {
  const data = base64.includes(",") ? (base64.split(",")[1] ?? base64) : base64;
  return {
    filename,
    mediaType: normalizeDocumentMediaType(mediaType, filename),
    data,
  };
}

type ProviderContentBlock = Record<string, unknown>;

async function mapResolvedUserContent(
  content: string | MessageContentPart[],
  provider: ProviderName,
  mapText: (text: string) => ProviderContentBlock,
  mapDocument: (part: Extract<MessageContentPart, { type: "document" }>) => ProviderContentBlock,
  mapImage: (part: Extract<MessageContentPart, { type: "image" }>) => ProviderContentBlock,
): Promise<string | ProviderContentBlock[]> {
  const resolved = await resolveUserContentForProvider(content, provider);

  if (typeof resolved === "string") {
    return resolved;
  }

  return resolved.map((part) => {
    if (part.type === "text") {
      return mapText(part.text);
    }

    if (part.type === "document") {
      return mapDocument(part);
    }

    return mapImage(part);
  });
}

export async function toAnthropicUserContent(
  content: string | MessageContentPart[],
  provider: ProviderName = "anthropic",
): Promise<string | Array<Record<string, unknown>>> {
  return mapResolvedUserContent(
    content,
    provider,
    (text) => ({ type: "text", text }),
    (part) => toAnthropicDocumentBlock(part),
    (part) => ({
      type: "image",
      source: {
        type: "base64",
        media_type: part.mediaType,
        data: part.data,
      },
    }),
  );
}

export async function toOpenAIChatUserContent(
  content: string | MessageContentPart[],
  provider: ProviderName = "openai",
): Promise<string | Array<Record<string, unknown>>> {
  return mapResolvedUserContent(
    content,
    provider,
    (text) => ({ type: "text", text }),
    (part) => toOpenAIResponsesDocumentBlock(part, toDataUrl),
    (part) => ({
      type: "image_url",
      image_url: { url: toDataUrl(part.mediaType, part.data) },
    }),
  );
}

export async function toOpenAIResponsesUserContent(
  content: string | MessageContentPart[],
  provider: ProviderName = "openai",
): Promise<string | Array<Record<string, unknown>>> {
  return mapResolvedUserContent(
    content,
    provider,
    (text) => ({ type: "input_text", text }),
    (part) => toOpenAIResponsesDocumentBlock(part, toDataUrl),
    (part) => ({
      type: "input_image",
      image_url: toDataUrl(part.mediaType, part.data),
    }),
  );
}
