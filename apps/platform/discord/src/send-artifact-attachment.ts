import {
  inferArtifactMimeType,
  normalizeMimeType,
} from "@nakama/core/artifact-mime";
import { AttachmentBuilder, type TextBasedChannel } from "discord.js";

export const DISCORD_ARTIFACT_ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;

/** Common Discord-friendly attachment types (issue #200 + existing channel artifacts). */
const DISCORD_ATTACHABLE_EXTENSIONS = new Set([
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "txt",
  "csv",
  "tsv",
  "md",
  "markdown",
  "json",
  "zip",
  "docx",
  "html",
  "htm",
]);

const DISCORD_ATTACHABLE_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "text/plain",
  "text/csv",
  "text/tab-separated-values",
  "text/markdown",
  "application/json",
  "application/zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/html",
  "application/xhtml+xml",
]);

export interface SendArtifactAttachmentInput {
  bytes: Uint8Array;
  filename: string;
  mimeType?: string;
}

export interface SendArtifactAttachmentResult {
  error?: string;
  ok: boolean;
}

export function isDiscordAttachableArtifact(input: {
  filename: string;
  mimeType?: string;
}): boolean {
  const extension = fileExtension(input.filename);
  if (extension && DISCORD_ATTACHABLE_EXTENSIONS.has(extension)) {
    return true;
  }

  const mimeType =
    normalizeMimeType(input.mimeType ?? "") ||
    inferArtifactMimeType(input.filename);
  return DISCORD_ATTACHABLE_MIME_TYPES.has(mimeType);
}

export async function sendDiscordArtifactAttachment(
  channel: TextBasedChannel,
  input: SendArtifactAttachmentInput
): Promise<SendArtifactAttachmentResult> {
  if (input.bytes.byteLength > DISCORD_ARTIFACT_ATTACHMENT_MAX_BYTES) {
    return {
      error: `File is too large for Discord (${formatMegabytes(input.bytes.byteLength)}; max ${formatMegabytes(DISCORD_ARTIFACT_ATTACHMENT_MAX_BYTES)}). Use the share link instead.`,
      ok: false,
    };
  }

  if (!isDiscordAttachableArtifact(input)) {
    const extension = fileExtension(input.filename);
    const typeLabel = extension
      ? `.${extension}`
      : input.mimeType?.trim() || "unknown";
    return {
      error: `Unsupported file type for Discord attachment (${typeLabel}). Supported: PDF, images (PNG/JPEG/GIF/WebP), text, CSV, ZIP, and common document types.`,
      ok: false,
    };
  }

  try {
    const attachment = new AttachmentBuilder(Buffer.from(input.bytes)).setName(
      input.filename
    );
    await channel.send({ files: [attachment] });
    return { ok: true };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Failed to send attachment.",
      ok: false,
    };
  }
}

function fileExtension(filename: string): string {
  const basename = filename.split(/[\\/]/).pop() ?? filename;
  const dotIndex = basename.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === basename.length - 1) {
    return "";
  }
  return basename.slice(dotIndex + 1).toLowerCase();
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
