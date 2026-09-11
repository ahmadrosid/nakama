import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { ImageAttachment, SendMessageInput } from "@nakama/core";
import { getUserConfigDir, MAX_IMAGE_BYTES } from "@nakama/core";

const IMAGE_PATH_PATTERN = /^@(\S+)(?:\s+([\s\S]*))?$/;

const EXTENSION_MEDIA_TYPES: Record<string, string> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

/**
 * Resolve `@path` image reads to an allowlisted absolute path.
 * Allowed roots: process.cwd() and the Nakama config dir (`~/.nakama` or
 * `NAKAMA_CONFIG_DIR`). Blocks clipboard-stuffed absolute paths like
 * `/etc/passwd` (#545).
 */
export function resolveAllowedImagePath(filePath: string): string {
  if (filePath.includes("\0")) {
    throw new Error("Image path contains a null byte.");
  }

  const expanded = expandHome(filePath);
  const absolute = path.resolve(process.cwd(), expanded);
  const allowedRoots = resolveAllowedRoots();

  let realPath: string;
  try {
    realPath = realpathSync(absolute);
  } catch {
    realPath = absolute;
  }

  if (!isWithinRoots(realPath, allowedRoots)) {
    throw new Error(
      `Image path is outside allowed directories (cwd or Nakama config dir): ${filePath}`
    );
  }

  return realPath;
}

function expandHome(filePath: string): string {
  if (filePath === "~") {
    return process.env.HOME ?? homedir();
  }
  if (filePath.startsWith("~/")) {
    return path.join(process.env.HOME ?? homedir(), filePath.slice(2));
  }
  return filePath;
}

function resolveAllowedRoots(): string[] {
  const roots = [process.cwd(), getUserConfigDir()];
  return roots.map((root) => {
    try {
      return realpathSync(root);
    } catch {
      return path.resolve(root);
    }
  });
}

function isWithinRoots(target: string, roots: string[]): boolean {
  for (const root of roots) {
    if (target === root) {
      return true;
    }
    // Compare target against `root + sep`, not `target + sep` against `root +
    // sep` — otherwise cwd `/tmp/fo` would falsely allow `/tmp/foo/secret`.
    const prefix = root.endsWith(path.sep) ? root : root + path.sep;
    if (target.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

export async function parseImageLine(
  line: string
): Promise<SendMessageInput | null> {
  const match = IMAGE_PATH_PATTERN.exec(line.trim());

  if (!match) {
    return null;
  }

  const filePath = match[1]!;
  const message = (match[2] ?? "").trim();
  const resolvedPath = resolveAllowedImagePath(filePath);

  if (!existsSync(resolvedPath)) {
    throw new Error(`Image file not found: ${filePath}`);
  }

  const file = Bun.file(resolvedPath);
  const size = file.size;

  if (size > MAX_IMAGE_BYTES) {
    throw new Error(
      `Image file is too large (${size} bytes). Maximum is ${MAX_IMAGE_BYTES / (1024 * 1024)} MB.`
    );
  }

  const extension = resolvedPath
    .slice(resolvedPath.lastIndexOf("."))
    .toLowerCase();
  const mediaType = EXTENSION_MEDIA_TYPES[extension];

  if (!mediaType) {
    throw new Error(
      `Unsupported image extension "${extension}". Use .png, .jpg, .gif, or .webp.`
    );
  }

  const data = Buffer.from(await file.arrayBuffer()).toString("base64");
  const images: ImageAttachment[] = [{ data, mediaType }];

  return { images, message };
}

export function mergeSendInput(
  text: string,
  options: {
    promptImages?: ImageAttachment[];
    fromPath?: SendMessageInput | null;
  } = {}
): SendMessageInput {
  if (options.fromPath) {
    return options.fromPath;
  }

  if (options.promptImages?.length) {
    return { images: options.promptImages, message: text };
  }

  return { message: text };
}
