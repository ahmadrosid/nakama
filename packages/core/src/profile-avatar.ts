import { join } from "node:path";
import type { ImageAttachment } from "./contract";
import {
  ensureDir,
  readBytes,
  readDirectoryOrEmpty,
  removeFile,
  writePrivateBytesFile,
} from "./fs";
import { validateImageAttachments } from "./message-content";
import { getProfileSoulDir } from "./soul/resolve";

const AVATAR_BASENAME = "avatar";

const MEDIA_TYPE_TO_EXTENSION: Record<string, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const EXTENSION_TO_MEDIA_TYPE: Record<string, string> = {
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export interface ProfileAvatarData {
  bytes: Buffer;
  mediaType: string;
}

export function getProfileAvatarPath(
  orgId: string,
  profileId: string,
  mediaType?: string
): string {
  const directory = getProfileSoulDir(orgId, profileId);

  if (!mediaType) {
    return join(directory, AVATAR_BASENAME);
  }

  const extension = MEDIA_TYPE_TO_EXTENSION[mediaType];

  if (!extension) {
    throw new Error(`Unsupported avatar media type: ${mediaType}`);
  }

  return join(directory, `${AVATAR_BASENAME}.${extension}`);
}

export async function hasProfileAvatar(
  orgId: string,
  profileId: string
): Promise<boolean> {
  return (await findProfileAvatarFile(orgId, profileId)) !== null;
}

export async function saveProfileAvatar(
  orgId: string,
  profileId: string,
  attachment: ImageAttachment
): Promise<void> {
  validateImageAttachments([attachment]);

  const directory = getProfileSoulDir(orgId, profileId);
  await ensureDir(directory);
  await deleteProfileAvatar(orgId, profileId);

  const base64 = attachment.data.includes(",")
    ? (attachment.data.split(",")[1] ?? "")
    : attachment.data;
  const bytes = Buffer.from(base64, "base64");
  const filePath = getProfileAvatarPath(orgId, profileId, attachment.mediaType);

  await writePrivateBytesFile(filePath, bytes);
}

export async function readProfileAvatar(
  orgId: string,
  profileId: string
): Promise<ProfileAvatarData | null> {
  const filePath = await findProfileAvatarFile(orgId, profileId);

  if (!filePath) {
    return null;
  }

  const extension = filePath.slice(filePath.lastIndexOf(".") + 1).toLowerCase();
  const mediaType = EXTENSION_TO_MEDIA_TYPE[extension];

  if (!mediaType) {
    return null;
  }

  const bytes = await readBytes(filePath);

  return { bytes, mediaType };
}

export async function deleteProfileAvatar(
  orgId: string,
  profileId: string
): Promise<boolean> {
  const directory = getProfileSoulDir(orgId, profileId);
  const entries = await readDirectoryOrEmpty(directory);
  let removed = false;

  for (const entry of entries) {
    if (!entry.startsWith(`${AVATAR_BASENAME}.`)) {
      continue;
    }

    await removeFile(join(directory, entry));
    removed = true;
  }

  return removed;
}

async function findProfileAvatarFile(
  orgId: string,
  profileId: string
): Promise<string | null> {
  const directory = getProfileSoulDir(orgId, profileId);
  const entries = await readDirectoryOrEmpty(directory);

  for (const entry of entries) {
    if (!entry.startsWith(`${AVATAR_BASENAME}.`)) {
      continue;
    }

    const extension = entry.slice(entry.lastIndexOf(".") + 1).toLowerCase();

    if (EXTENSION_TO_MEDIA_TYPE[extension]) {
      return join(directory, entry);
    }
  }

  return null;
}
