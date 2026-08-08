import type {
  AgentChannel,
  LoadAttachmentBytes,
  SaveInlineAttachment,
} from "@nakama/core";
import { createId } from "@nakama/core";
import {
  readAttachmentBytes,
  saveAttachmentBytes,
} from "@nakama/core/attachments/store";
import type { DatabaseAdapter, StoredAttachmentRecord } from "@nakama/db";

export interface AttachmentServiceContext {
  channel: AgentChannel;
  orgId: string;
  profileId: string;
  sessionId: string;
}

export function createAttachmentSaver(
  db: DatabaseAdapter,
  context: AttachmentServiceContext
): SaveInlineAttachment {
  return async (input) => {
    const attachmentId = createId("att");
    const storagePath = await saveAttachmentBytes(
      context.orgId,
      context.profileId,
      attachmentId,
      input.bytes
    );
    const now = new Date().toISOString();
    const record: StoredAttachmentRecord = {
      channel: context.channel,
      createdAt: now,
      filename: input.filename ?? null,
      id: attachmentId,
      kind: input.kind,
      mediaType: input.mediaType,
      orgId: context.orgId,
      profileId: context.profileId,
      sessionId: context.sessionId,
      sizeBytes: input.bytes.byteLength,
      storagePath,
    };

    await db.insertAttachment(record);

    return {
      attachmentId,
      size: input.bytes.byteLength,
    };
  };
}

export function createAttachmentLoader(
  db: DatabaseAdapter,
  context: Pick<AttachmentServiceContext, "orgId" | "profileId">
): LoadAttachmentBytes {
  return async (attachmentId) => {
    const record = await db.getAttachment(attachmentId);

    if (!record || record.profileId !== context.profileId) {
      return null;
    }

    const bytes = await readAttachmentBytes(
      context.orgId,
      context.profileId,
      attachmentId
    );

    if (!bytes) {
      return null;
    }

    return {
      bytes,
      filename: record.filename,
      mediaType: record.mediaType,
    };
  };
}
