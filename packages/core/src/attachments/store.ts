import { join } from "node:path";
import { ensureDir, readBytes, removeFile, writePrivateBytesFile } from "../fs";
import { getProfileSoulDir } from "../soul/resolve";

const ATTACHMENTS_DIR = "attachments";

export function getAttachmentDir(orgId: string, profileId: string): string {
  return join(getProfileSoulDir(orgId, profileId), ATTACHMENTS_DIR);
}

export function getAttachmentFilePath(
  orgId: string,
  profileId: string,
  attachmentId: string,
): string {
  return join(getAttachmentDir(orgId, profileId), attachmentId);
}

export async function saveAttachmentBytes(
  orgId: string,
  profileId: string,
  attachmentId: string,
  bytes: Buffer,
): Promise<string> {
  const path = getAttachmentFilePath(orgId, profileId, attachmentId);
  await ensureDir(getAttachmentDir(orgId, profileId));
  await writePrivateBytesFile(path, bytes);
  return path;
}

export async function readAttachmentBytes(
  orgId: string,
  profileId: string,
  attachmentId: string,
): Promise<Buffer | null> {
  try {
    return await readBytes(getAttachmentFilePath(orgId, profileId, attachmentId));
  } catch {
    return null;
  }
}

export async function deleteAttachmentBytes(
  orgId: string,
  profileId: string,
  attachmentId: string,
): Promise<void> {
  try {
    await removeFile(getAttachmentFilePath(orgId, profileId, attachmentId));
  } catch {
    // ponytail: missing file is fine on delete
  }
}
