import type {
  AgentChannel,
  ChatMessage,
  MessageContentPart,
} from "../contract";

export interface SavedInlineAttachment {
  attachmentId: string;
  size: number;
}

export interface SaveInlineAttachmentInput {
  bytes: Buffer;
  filename?: string;
  kind: "image" | "document";
  mediaType: string;
}

export type SaveInlineAttachment = (
  input: SaveInlineAttachmentInput
) => Promise<SavedInlineAttachment>;

export interface LoadedAttachmentBytes {
  bytes: Buffer;
  filename?: string | null;
  mediaType: string;
}

export type LoadAttachmentBytes = (
  attachmentId: string
) => Promise<LoadedAttachmentBytes | null>;

export function messageContentHasImageRefs(
  content: string | MessageContentPart[]
): boolean {
  return countUserImageRefs(content) > 0;
}

export function messageContentHasDocumentRefs(
  content: string | MessageContentPart[]
): boolean {
  return countUserDocumentRefs(content) > 0;
}

export function countUserImageRefs(
  content: string | MessageContentPart[]
): number {
  if (typeof content === "string") {
    return 0;
  }

  return content.filter((part) => part.type === "image_ref").length;
}

export function countUserDocumentRefs(
  content: string | MessageContentPart[]
): number {
  if (typeof content === "string") {
    return 0;
  }

  return content.filter((part) => part.type === "document_ref").length;
}

export function messagesIncludeUserImageRefs(
  messages: readonly ChatMessage[]
): boolean {
  return messages.some(
    (message) =>
      message.role === "user" && messageContentHasImageRefs(message.content)
  );
}

export function messagesIncludeUserDocumentRefs(
  messages: readonly ChatMessage[]
): boolean {
  return messages.some(
    (message) =>
      message.role === "user" && messageContentHasDocumentRefs(message.content)
  );
}

export function messageContentHasInlineAttachments(
  content: string | MessageContentPart[]
): boolean {
  if (typeof content === "string") {
    return false;
  }

  return content.some(
    (part) => part.type === "image" || part.type === "document"
  );
}

export async function persistInlineAttachmentsInContent(
  content: string | MessageContentPart[],
  save: SaveInlineAttachment
): Promise<string | MessageContentPart[]> {
  if (
    typeof content === "string" ||
    !messageContentHasInlineAttachments(content)
  ) {
    return content;
  }

  const result: MessageContentPart[] = [];

  for (const part of content) {
    if (part.type === "image") {
      const bytes = Buffer.from(part.data, "base64");
      const saved = await save({
        bytes,
        kind: "image",
        mediaType: part.mediaType,
      });

      result.push({
        attachmentId: saved.attachmentId,
        mediaType: part.mediaType,
        size: saved.size,
        type: "image_ref",
      });
      continue;
    }

    if (part.type === "document") {
      const bytes = Buffer.from(part.data, "base64");
      const saved = await save({
        bytes,
        filename: part.filename,
        kind: "document",
        mediaType: part.mediaType,
      });

      result.push({
        attachmentId: saved.attachmentId,
        filename: part.filename,
        mediaType: part.mediaType,
        size: saved.size,
        type: "document_ref",
      });
      continue;
    }

    result.push(part);
  }

  return result;
}

export async function rehydrateAttachmentRefsInContent(
  content: string | MessageContentPart[],
  load: LoadAttachmentBytes
): Promise<string | MessageContentPart[]> {
  if (typeof content === "string") {
    return content;
  }

  const hasRefs = content.some(
    (part) => part.type === "image_ref" || part.type === "document_ref"
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
        data: loaded.bytes.toString("base64"),
        mediaType: loaded.mediaType,
        type: "image",
      });
      continue;
    }

    if (part.type === "document_ref") {
      const loaded = await load(part.attachmentId);

      if (!loaded) {
        throw new Error(`Attachment not found: ${part.attachmentId}`);
      }

      result.push({
        data: loaded.bytes.toString("base64"),
        filename: part.filename,
        mediaType: loaded.mediaType,
        type: "document",
      });
      continue;
    }

    result.push(part);
  }

  return result;
}

export async function rehydrateMessagesForProvider(
  messages: readonly ChatMessage[],
  load: LoadAttachmentBytes
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
  channel: AgentChannel;
  orgId: string;
  profileId: string;
  sessionId: string;
}
