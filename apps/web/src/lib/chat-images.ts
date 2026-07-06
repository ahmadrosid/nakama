import type { DocumentAttachment, ImageAttachment, MessageContentPart } from "@nakama/core/contract";
import {
  isImageDescriptionText,
  parseImageDescriptionText,
} from "@nakama/core/image-content";
import { normalizeDocumentMediaType, parseDataUrl, parseDocumentDataUrl } from "@nakama/core/message-content";
import type { FileUIPart } from "ai";
import {
  documentDisplayFromContentPart,
  documentDisplayFromFilePart,
  type DisplayDocument,
} from "@/lib/pasted-text";

export const IMAGE_ACCEPT =
  "image/jpeg,image/png,image/gif,image/webp";

export const DOCUMENT_ACCEPT =
  ".pdf,.docx,.csv,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/csv";

export const ALL_ATTACHMENT_ACCEPT = `${IMAGE_ACCEPT},${DOCUMENT_ACCEPT}`;

export function isImageFilePart(file: FileUIPart): boolean {
  return Boolean(file.mediaType?.startsWith("image/"));
}

export function isDocumentFilePart(file: FileUIPart): boolean {
  if (isImageFilePart(file)) {
    return false;
  }

  const filename = file.filename ?? "";
  const mediaType = normalizeDocumentMediaType(file.mediaType ?? "", filename);
  return (
    mediaType === "application/pdf" ||
    mediaType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mediaType === "text/plain" ||
    mediaType === "text/csv"
  );
}

export function filePartsToImageAttachments(files: FileUIPart[]): ImageAttachment[] {
  const images: ImageAttachment[] = [];

  for (const file of files) {
    if (!isImageFilePart(file)) {
      continue;
    }

    const parsed = parseDataUrl(file.url);

    if (parsed) {
      images.push(parsed);
    }
  }

  return images;
}

export function filePartsToDocumentAttachments(files: FileUIPart[]): DocumentAttachment[] {
  const documents: DocumentAttachment[] = [];

  for (const file of files) {
    if (!isDocumentFilePart(file)) {
      continue;
    }

    const filename = file.filename?.trim() || "document";
    const parsed = parseDocumentDataUrl(file.url, filename);

    if (parsed) {
      documents.push(parsed);
    }
  }

  return documents;
}

export function userContentToDisplayImages(
  content: string | MessageContentPart[],
): Array<{ url: string; mediaType: string }> {
  if (typeof content === "string") {
    return [];
  }

  return content
    .filter(
      (part): part is Extract<typeof part, { type: "image" }> =>
        part.type === "image" && !part.description?.trim(),
    )
    .map((part) => ({
      mediaType: part.mediaType,
      url: `data:${part.mediaType};base64,${part.data}`,
    }));
}

export interface DisplayImageAttachment {
  url?: string;
  mediaType: string;
  description?: string | null;
}

export function userContentToDisplayImageAttachments(
  content: string | MessageContentPart[],
): DisplayImageAttachment[] {
  const attachments: DisplayImageAttachment[] = [];

  if (typeof content === "string") {
    if (isImageDescriptionText(content)) {
      attachments.push({
        mediaType: "image/unknown",
        description: parseImageDescriptionText(content),
      });
    }

    return attachments;
  }

  for (const part of content) {
    if (part.type === "image" && part.description?.trim()) {
      attachments.push({
        mediaType: part.mediaType,
        url: `data:${part.mediaType};base64,${part.data}`,
        description: part.description.trim(),
      });
      continue;
    }

    if (part.type === "text" && isImageDescriptionText(part.text)) {
      attachments.push({
        mediaType: "image/unknown",
        description: parseImageDescriptionText(part.text),
      });
    }
  }

  return attachments;
}

export function stripImageDescriptionsFromDisplayText(
  content: string | MessageContentPart[],
): string {
  if (typeof content === "string") {
    return isImageDescriptionText(content) ? "" : content;
  }

  return content
    .filter(
      (part): part is Extract<MessageContentPart, { type: "text" }> =>
        part.type === "text" && !isImageDescriptionText(part.text),
    )
    .map((part) => part.text)
    .join("\n")
    .trim();
}

export function parseLegacyImageDescriptionText(text: string): string | null {
  return parseImageDescriptionText(text);
}

export function filePartsToDisplayDocuments(files: FileUIPart[]): DisplayDocument[] {
  const documents: DisplayDocument[] = [];

  for (const file of files) {
    if (!isDocumentFilePart(file)) {
      continue;
    }

    documents.push(documentDisplayFromFilePart(file));
  }

  return documents;
}

export function userContentToDisplayDocuments(
  content: string | MessageContentPart[],
): DisplayDocument[] {
  if (typeof content === "string") {
    return [];
  }

  return content
    .filter((part): part is Extract<typeof part, { type: "document" }> => part.type === "document")
    .map((part) => documentDisplayFromContentPart(part));
}
