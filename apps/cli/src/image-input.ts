import { existsSync } from "node:fs";
import type { ImageAttachment, SendMessageInput } from "@nakama/core";
import { MAX_IMAGE_BYTES } from "@nakama/core";

const IMAGE_PATH_PATTERN = /^@(\S+)(?:\s+([\s\S]*))?$/;

const EXTENSION_MEDIA_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export async function parseImageLine(line: string): Promise<SendMessageInput | null> {
  const match = IMAGE_PATH_PATTERN.exec(line.trim());

  if (!match) {
    return null;
  }

  const filePath = match[1]!;
  const message = (match[2] ?? "").trim();

  if (!existsSync(filePath)) {
    throw new Error(`Image file not found: ${filePath}`);
  }

  const file = Bun.file(filePath);
  const size = file.size;

  if (size > MAX_IMAGE_BYTES) {
    throw new Error(
      `Image file is too large (${size} bytes). Maximum is ${MAX_IMAGE_BYTES / (1024 * 1024)} MB.`,
    );
  }

  const extension = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  const mediaType = EXTENSION_MEDIA_TYPES[extension];

  if (!mediaType) {
    throw new Error(
      `Unsupported image extension "${extension}". Use .png, .jpg, .gif, or .webp.`,
    );
  }

  const data = Buffer.from(await file.arrayBuffer()).toString("base64");
  const images: ImageAttachment[] = [{ mediaType, data }];

  return { message, images };
}

export function mergeSendInput(
  text: string,
  options: {
    promptImages?: ImageAttachment[];
    fromPath?: SendMessageInput | null;
  } = {},
): SendMessageInput {
  if (options.fromPath) {
    return options.fromPath;
  }

  if (options.promptImages?.length) {
    return { message: text, images: options.promptImages };
  }

  return { message: text };
}
