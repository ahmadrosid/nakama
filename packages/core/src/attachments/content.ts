import type { AgentChannel, ChatMessage, MessageContentPart } from "../contract";

export interface SavedInlineAttachment {
  attachmentId: string;
  size: number;
}

export interface SaveInlineAttachmentInput {
  kind: "image" | "document";
  mediaType: string;
  filename?: string;
  bytes: Buffer;
}

export type SaveInlineAttachment = (
  input: SaveInlineAttachmentInput,
) => Promise<SavedInlineAttachment>;

export interface LoadedAttachmentBytes {
  bytes: Buffer;
  mediaType: string;
  filename?: string | null;
}

export type LoadAttachmentBytes = (
  attachmentId: string,
) => Promise<LoadedAttachmentBytes | null>;

export function messageContentHasImageRefs(
  content: string | MessageContentPart[],
): boolean {
  return countUserImageRefs(content) > 0;
}

export function messageContentHasDocumentRefs(
  content: string | MessageContentPart[],
): boolean {
  return countUserDocumentRefs(content) > 0;
}

export function countUserImageRefs(content: string | MessageContentPart[]): number {
  if (typeof content === "string") {
    return 0;
  }

  return content.filter((part) => part.type === "image_ref").length;
}

export function countUserDocumentRefs(content: string | MessageContentPart[]): number {
  if (typeof content === "string") {
    return 0;
  }

  return content.filter((part) => part.type === "document_ref").length;
}

export function messagesIncludeUserImageRefs(messages: readonly ChatMessage[]): boolean {
  return messages.some(
    (message) => message.role === "user" && messageContentHasImageRefs(message.content),
  );
}

export function messagesIncludeUserDocumentRefs(messages: readonly ChatMessage[]): boolean {
  return messages.some(
    (message) => message.role === "user" && messageContentHasDocumentRefs(message.content),
  );
}

export function messageContentHasInlineAttachments(
  content: string | MessageContentPart[],
): boolean {
  if (typeof content === "string") {
    return false;
  }

  return content.some((part) => part.type === "image" || part.type === "document");
}

export async function persistInlineAttachmentsInContent(
  content: string | MessageContentPart[],
  save: SaveInlineAttachment,
): Promise<string | MessageContentPart[]> {
  if (typeof content === "string" || !messageContentHasInlineAttachments(content)) {
    return content;
  }

  const result: MessageContentPart[] = [];

  for (const part of content) {
    if (part.type === "image") {
      const bytes = Buffer.from(part.data, "base64");
      const saved = await save({
        kind: "image",
        mediaType: part.mediaType,
        bytes,
      });

      result.push({
        type: "image_ref",
        attachmentId: saved.attachmentId,
        mediaType: part.mediaType,
        size: saved.size,
      });
      continue;
    }

    if (part.type === "document") {
      const bytes = Buffer.from(part.data, "base64");
      const saved = await save({
        kind: "document",
        mediaType: part.mediaType,
        filename: part.filename,
        bytes,
      });

      result.push({
        type: "document_ref",
        attachmentId: saved.attachmentId,
        filename: part.filename,
        mediaType: part.mediaType,
        size: saved.size,
      });
      continue;
    }

    result.push(part);
  }

  return result;
}

export async function rehydrateAttachmentRefsInContent(
  content: string | MessageContentPart[],
  load: LoadAttachmentBytes,
): Promise<string | MessageContentPart[]> {
  if (typeof content === "string") {
    return content;
  }

  const hasRefs = content.some(
    (part) => part.type === "image_ref" || part.type === "document_ref",
  );

  if (!hasRefs) {
    return content;
  }

  const result: MessageContentPart[] = [];

  for (const part of content) {
    if (part.type === "image_ref") {
      const loaded = await load(part.attachmentId);

      if (!loaded) {
        throw new Error(`Attachment not found: ${part.attachmentId}`);
      }

      result.push({
        type: "image",
        mediaType: loaded.mediaType,
        data: loaded.bytes.toString("base64"),
      });
      continue;
    }

    if (part.type === "document_ref") {
      const loaded = await load(part.attachmentId);

      if (!loaded) {
        throw new Error(`Attachment not found: ${part.attachmentId}`);
      }

      result.push({
        type: "document",
        filename: part.filename,
        mediaType: loaded.mediaType,
        data: loaded.bytes.toString("base64"),
      });
      continue;
    }

    result.push(part);
  }

  return result;
}

export async function rehydrateMessagesForProvider(
  messages: readonly ChatMessage[],
  load: LoadAttachmentBytes,
): Promise<ChatMessage[]> {
  const result: ChatMessage[] = [];

  for (const message of messages) {
    if (message.role !== "user") {
      result.push(message);
      continue;
    }

    result.push({
      ...message,
      content: await rehydrateAttachmentRefsInContent(message.content, load),
    });
  }

  return result;
}

export interface AttachmentPersistenceContext {
  orgId: string;
  profileId: string;
  sessionId: string;
  channel: AgentChannel;
}
