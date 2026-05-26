import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ImageAttachment } from "./contract";
import { validateImageAttachments } from "./message-content";
import { getProfileSoulDir } from "./soul/paths";

const AVATAR_BASENAME = "avatar";

const MEDIA_TYPE_TO_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

const EXTENSION_TO_MEDIA_TYPE: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

export interface ProfileAvatarData {
  mediaType: string;
  bytes: Buffer;
}

export function getProfileAvatarPath(profileId: string, mediaType?: string): string {
  const directory = getProfileSoulDir(profileId);

  if (!mediaType) {
    return join(directory, AVATAR_BASENAME);
  }

  const extension = MEDIA_TYPE_TO_EXTENSION[mediaType];

  if (!extension) {
    throw new Error(`Unsupported avatar media type: ${mediaType}`);
  }

  return join(directory, `${AVATAR_BASENAME}.${extension}`);
}

export async function hasProfileAvatar(profileId: string): Promise<boolean> {
  return (await findProfileAvatarFile(profileId)) !== null;
}

export async function saveProfileAvatar(
  profileId: string,
  attachment: ImageAttachment,
): Promise<void> {
  validateImageAttachments([attachment]);

  const directory = getProfileSoulDir(profileId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await deleteProfileAvatar(profileId);

  const base64 = attachment.data.includes(",")
    ? (attachment.data.split(",")[1] ?? "")
    : attachment.data;
  const bytes = Buffer.from(base64, "base64");
  const filePath = getProfileAvatarPath(profileId, attachment.mediaType);

  await writeFile(filePath, bytes, { mode: 0o600 });
}

export async function readProfileAvatar(profileId: string): Promise<ProfileAvatarData | null> {
  const filePath = await findProfileAvatarFile(profileId);

  if (!filePath) {
    return null;
  }

  const extension = filePath.slice(filePath.lastIndexOf(".") + 1).toLowerCase();
  const mediaType = EXTENSION_TO_MEDIA_TYPE[extension];

  if (!mediaType) {
    return null;
  }

  const bytes = await readFile(filePath);

  return { mediaType, bytes };
}

export async function deleteProfileAvatar(profileId: string): Promise<boolean> {
  const directory = getProfileSoulDir(profileId);
  let removed = false;

  try {
    const entries = await readdir(directory);

    for (const entry of entries) {
      if (!entry.startsWith(`${AVATAR_BASENAME}.`)) {
        continue;
      }

      await unlink(join(directory, entry));
      removed = true;
    }
  } catch {
    return false;
  }

  return removed;
}

async function findProfileAvatarFile(profileId: string): Promise<string | null> {
  const directory = getProfileSoulDir(profileId);

  try {
    const entries = await readdir(directory);

    for (const entry of entries) {
      if (!entry.startsWith(`${AVATAR_BASENAME}.`)) {
        continue;
      }

      const extension = entry.slice(entry.lastIndexOf(".") + 1).toLowerCase();

      if (EXTENSION_TO_MEDIA_TYPE[extension]) {
        return join(directory, entry);
      }
    }
  } catch {
    return null;
  }

  return null;
}
