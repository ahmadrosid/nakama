import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import type {
  AgentChannel,
  LoadAttachmentBytes,
  SaveInlineAttachment,
} from "@nakama/core";
import {
  createId,
  getChatWorkspaceDir,
  getProfileSoulDir,
  getUserConfigDir,
} from "@nakama/core";
import { saveAttachmentBytes } from "@nakama/core/attachments/store";
import type { DatabaseAdapter, StoredAttachmentRecord } from "@nakama/db";
import {
  acquireWorkspaceWrite,
  resolveWorkspaceFile,
  workspaceFilePath,
} from "./chat-workspace-service";

export interface AttachmentServiceContext {
  channel: AgentChannel;
  chatRoot?: string;
  /** True in a cognito session, which pairs with a null sessionId. */
  ephemeral?: boolean;
  existingPath?: string;
  orgId: string;
  profileId: string;
  purpose?: "input" | "output" | "reference";
  /** Null in a cognito session: there is no `sessions` row to point at. */
  sessionId: string | null;
  workspaceId?: string;
  workspaceRoot?: string;
}

export function createAttachmentSaver(
  db: DatabaseAdapter,
  context: AttachmentServiceContext
): SaveInlineAttachment {
  return async (input) => {
    const release = context.workspaceId
      ? acquireWorkspaceWrite(context.workspaceId)
      : () => undefined;
    try {
      if (
        context.workspaceId &&
        (await db.getWorkspace(context.workspaceId))?.state !== "active"
      ) {
        throw new Error("Workspace is unavailable.");
      }
      if (
        context.sessionId &&
        (await db.getSession(context.sessionId))?.deleting
      ) {
        throw new Error("Chat is being deleted.");
      }
      const attachmentId = createId("att");
      const target =
        context.existingPath ??
        (context.chatRoot
          ? join(
              context.chatRoot,
              context.purpose === "reference"
                ? "references"
                : context.purpose === "output"
                  ? "outputs"
                  : "inputs",
              `${attachmentId}-${(input.filename ?? "file").replace(/[^\w. -]+/g, "_")}`
            )
          : null);
      if (target && context.workspaceRoot) {
        await resolveWorkspaceFile(
          context.workspaceRoot,
          relative(context.workspaceRoot, target)
        );
      }
      if (target && !context.existingPath) {
        await mkdir(dirname(target), { mode: 0o700, recursive: true });
        await writeFile(target, input.bytes, { flag: "wx", mode: 0o600 });
      }
      const storagePath = target
        ? context.workspaceId && context.workspaceRoot
          ? relative(context.workspaceRoot, target)
          : target
        : await saveAttachmentBytes(
            context.orgId,
            context.profileId,
            attachmentId,
            input.bytes
          );
      const now = new Date().toISOString();
      const record: StoredAttachmentRecord = {
        channel: context.channel,
        createdAt: now,
        ephemeral: context.ephemeral ?? false,
        filename: input.filename ?? null,
        id: attachmentId,
        kind: input.kind,
        mediaType: input.mediaType,
        orgId: context.orgId,
        profileId: context.profileId,
        purpose: context.purpose ?? "input",
        sessionId: context.sessionId,
        sizeBytes: input.bytes.byteLength,
        storagePath,
        workspaceId: context.workspaceId ?? null,
      };

      try {
        await db.insertAttachment(record);
      } catch (error) {
        if (target && !context.existingPath) {
          await rm(target, { force: true });
        }
        throw error;
      }

      return {
        attachmentId,
        size: input.bytes.byteLength,
      };
    } finally {
      release();
    }
  };
}

export function createAttachmentLoader(
  db: DatabaseAdapter,
  context: Pick<
    AttachmentServiceContext,
    "orgId" | "profileId" | "workspaceId" | "workspaceRoot"
  > & { sessionId?: string }
): LoadAttachmentBytes {
  return async (attachmentId) => {
    const aliases = context.sessionId
      ? await db.listSessionFileAliases(context.sessionId)
      : [];
    const record = await db.getAttachment(
      aliases.find((alias) => alias.sourceFileId === attachmentId)?.fileId ??
        attachmentId
    );

    if (
      !record ||
      record.orgId !== context.orgId ||
      (context.workspaceId
        ? record.workspaceId !== context.workspaceId ||
          (record.purpose !== "reference" &&
            record.sessionId !== context.sessionId)
        : record.profileId !== context.profileId)
    ) {
      return null;
    }

    const bytes = await readStoredAttachmentBytes(record);

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

function attachmentStoragePath(record: StoredAttachmentRecord): string {
  if (!record.orgId) {
    throw new Error("Attachment has no organization.");
  }
  if (record.workspaceId) {
    return workspaceFilePath(
      getChatWorkspaceDir(record.orgId, record.workspaceId),
      record.storagePath
    );
  }
  const legacyRoot = getProfileSoulDir(record.orgId, record.profileId);
  if (
    !(
      record.storagePath.startsWith(legacyRoot + sep) ||
      (record.ephemeral &&
        record.storagePath.startsWith(
          join(getUserConfigDir(), "ephemeral") + sep
        ))
    )
  ) {
    throw new Error("Invalid legacy attachment path.");
  }
  return record.storagePath;
}

export async function readStoredAttachmentBytes(
  record: StoredAttachmentRecord
): Promise<Buffer | null> {
  try {
    const path =
      record.workspaceId && record.orgId
        ? await resolveWorkspaceFile(
            getChatWorkspaceDir(record.orgId, record.workspaceId),
            record.storagePath
          )
        : attachmentStoragePath(record);
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function deleteStoredAttachmentBytes(
  record: StoredAttachmentRecord
): Promise<void> {
  try {
    const path =
      record.workspaceId && record.orgId
        ? await resolveWorkspaceFile(
            getChatWorkspaceDir(record.orgId, record.workspaceId),
            record.storagePath
          )
        : attachmentStoragePath(record);
    await rm(path, { force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}
