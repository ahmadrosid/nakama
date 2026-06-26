import type { AgentChannel, LoadAttachmentBytes, SaveInlineAttachment } from "@tinyclaw/core";
import { createId } from "@tinyclaw/core";
import {
  readAttachmentBytes,
  saveAttachmentBytes,
} from "@tinyclaw/core/attachments/store";
import type { DatabaseAdapter, StoredAttachmentRecord } from "@tinyclaw/db";

export interface AttachmentServiceContext {
  orgId: string;
  profileId: string;
  sessionId: string;
  channel: AgentChannel;
}

export function createAttachmentSaver(
  db: DatabaseAdapter,
  context: AttachmentServiceContext,
): SaveInlineAttachment {
  return async (input) => {
    const attachmentId = createId("att");
    const storagePath = await saveAttachmentBytes(
      context.orgId,
      context.profileId,
      attachmentId,
      input.bytes,
    );
    const now = new Date().toISOString();
    const record: StoredAttachmentRecord = {
      id: attachmentId,
      orgId: context.orgId,
      profileId: context.profileId,
      sessionId: context.sessionId,
      channel: context.channel,
      kind: input.kind,
      filename: input.filename ?? null,
      mediaType: input.mediaType,
      sizeBytes: input.bytes.byteLength,
      storagePath,
      createdAt: now,
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
  context: Pick<AttachmentServiceContext, "orgId" | "profileId">,
): LoadAttachmentBytes {
  return async (attachmentId) => {
    const record = await db.getAttachment(attachmentId);

    if (!record || record.profileId !== context.profileId) {
      return null;
    }

    const bytes = await readAttachmentBytes(
      context.orgId,
      context.profileId,
      attachmentId,
    );

    if (!bytes) {
      return null;
    }

    return {
      bytes,
      mediaType: record.mediaType,
      filename: record.filename,
    };
  };
}
