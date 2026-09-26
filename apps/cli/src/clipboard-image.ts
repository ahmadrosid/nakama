import { realpathSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getFiles,
  getImageBinary,
  hasFiles,
  hasImage,
} from "@crosscopy/clipboard";
import {
  type ImageAttachment,
  MAX_IMAGE_BYTES,
  validateImageAttachments,
} from "@nakama/core";
import { resolveAllowedImagePath } from "./image-input";

export function pastedImagePath(text: string): string | null {
  let value = text.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  } else {
    value = value.replace(/\\([ ()'"[\]])/g, "$1");
  }
  if (value.startsWith("file://")) {
    try {
      value = fileURLToPath(value);
    } catch {
      return null;
    }
  }
  if (value.startsWith("~/")) {
    value = join(homedir(), value.slice(2));
  }
  return /^(?:\/|\.\.?\/|[a-z]:\\)[^\r\n\0]*\.(?:png|jpe?g|gif|webp)$/i.test(
    value
  )
    ? value
    : null;
}

export function detectClipboardImageMediaType(
  bytes: Uint8Array | Buffer
): ImageAttachment["mediaType"] {
  const eq = (sig: number[], off = 0) =>
    bytes.length >= off + sig.length &&
    sig.every((value, index) => bytes[off + index] === value);

  if (eq([0x89, 0x50, 0x4e, 0x47])) {
    return "image/png";
  }
  if (eq([0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  if (
    eq([0x47, 0x49, 0x46, 0x38]) &&
    (bytes[4] === 0x37 || bytes[4] === 0x39)
  ) {
    return "image/gif";
  }
  if (eq([0x52, 0x49, 0x46, 0x46]) && eq([0x57, 0x45, 0x42, 0x50], 8)) {
    return "image/webp";
  }

  throw new Error(
    "Unsupported clipboard image type. Allowed: jpeg, png, gif, webp."
  );
}

export function attachmentFromClipboardBytes(
  bytes: Uint8Array | Buffer
): ImageAttachment {
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new Error(
      `Clipboard image is too large (${bytes.length} bytes). Maximum is ${MAX_IMAGE_BYTES / (1024 * 1024)} MB.`
    );
  }

  return {
    data: Buffer.from(bytes).toString("base64"),
    mediaType: detectClipboardImageMediaType(bytes),
  };
}

export async function readClipboardImage(
  pastedPath?: string
): Promise<ImageAttachment | null> {
  const files = hasFiles() ? await getFiles() : [];
  const filePath = pastedPath ?? (files.length === 1 ? files[0] : undefined);
  if (filePath && pastedImagePath(filePath)) {
    const realPath = realpathSync(filePath);
    // Terminals can turn clipboard images into temporary files instead of native file entries.
    const temporaryDirs = [tmpdir()];
    if (process.platform === "darwin") {
      const userTemp = spawnSync("/usr/bin/getconf", ["DARWIN_USER_TEMP_DIR"], {
        encoding: "utf8",
        timeout: 1000,
      }).stdout?.trim();
      if (userTemp) {
        temporaryDirs.push(userTemp);
      }
    }
    const isTemporaryImage = temporaryDirs.some((dir) =>
      realPath.startsWith(realpathSync(dir) + sep)
    );
    const allowedPath =
      files.includes(filePath) || isTemporaryImage
        ? realPath
        : resolveAllowedImagePath(realPath);
    if (!statSync(allowedPath).isFile()) {
      throw new Error("Image path must be a regular file.");
    }
    const file = Bun.file(allowedPath);
    if (file.size > MAX_IMAGE_BYTES) {
      throw new Error("Image file exceeds the attachment size limit.");
    }
    const attachment = attachmentFromClipboardBytes(await file.bytes());
    validateImageAttachments([attachment]);
    return attachment;
  }
  if (!hasImage()) {
    return null;
  }

  const bytes = await getImageBinary();

  if (!bytes?.length) {
    return null;
  }

  const attachment = attachmentFromClipboardBytes(Buffer.from(bytes));
  validateImageAttachments([attachment]);
  return attachment;
}

import { spawnSync } from "node:child_process";
