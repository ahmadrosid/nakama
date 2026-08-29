import type { SendMessageInput } from "@nakama/core/contract";
import {
  MAX_DOCUMENT_BYTES,
  normalizeDocumentMediaType,
  validateDocumentAttachments,
} from "@nakama/core/message-content";
import type { Context } from "grammy";

const ALLOWED_DOCUMENT_MEDIA_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/csv",
]);

export const UNSUPPORTED_DOCUMENT_TYPES_REPLY =
  "Unsupported file type. Send pdf, docx, txt, or csv (max 5 MB).";

export const OVERSIZED_FILE_REPLY = "File is too large. Maximum size is 5 MB.";

export const UNSUPPORTED_MEDIA_REPLY =
  "Send text, a photo, voice message, or a supported document (pdf, docx, txt, csv — max 5 MB).";

export const DOWNLOAD_FAILED_REPLY = "Could not download that file. Try again.";

export class OversizedTelegramFileError extends Error {
  constructor() {
    super("File is too large.");
    this.name = "OversizedTelegramFileError";
  }
}

export interface DownloadedTelegramFile {
  bytes: ArrayBuffer;
  contentType: string | null;
  filePath: string;
}

/** Build Telegram file download URL with token as an encoded path segment. */
export function buildTelegramFileDownloadUrl(
  token: string,
  filePath: string
): URL {
  const path = ["file", `bot${token}`, ...filePath.split("/").filter(Boolean)]
    .map(encodeURIComponent)
    .join("/");
  return new URL(path, "https://api.telegram.org/");
}

export async function downloadTelegramFile(
  ctx: Context,
  fileId: string,
  maxBytes: number
): Promise<DownloadedTelegramFile> {
  const file = await ctx.api.getFile(fileId);

  if (!file.file_path) {
    throw new Error("Telegram did not return a file path.");
  }

  if (file.file_size !== undefined && file.file_size > maxBytes) {
    throw new OversizedTelegramFileError();
  }

  const url = buildTelegramFileDownloadUrl(ctx.api.token, file.file_path);
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download file (${response.status}).`);
  }

  const bytes = await response.arrayBuffer();

  if (bytes.byteLength > maxBytes) {
    throw new OversizedTelegramFileError();
  }

  return {
    bytes,
    contentType: response.headers.get("content-type"),
    filePath: file.file_path,
  };
}

export type TelegramDocumentBuildResult =
  | { kind: "input"; input: SendMessageInput }
  | { kind: "reject"; message: string }
  | null;

export async function buildTelegramDocumentInput(
  ctx: Context
): Promise<TelegramDocumentBuildResult> {
  const document = ctx.message?.document;

  if (!document) {
    return null;
  }

  if (document.mime_type?.startsWith("image/")) {
    return null;
  }

  const filename = document.file_name?.trim() || "document";
  const mediaType = normalizeDocumentMediaType(
    document.mime_type ?? "",
    filename
  );

  if (!ALLOWED_DOCUMENT_MEDIA_TYPES.has(mediaType)) {
    return { kind: "reject", message: UNSUPPORTED_DOCUMENT_TYPES_REPLY };
  }

  if (
    document.file_size !== undefined &&
    document.file_size > MAX_DOCUMENT_BYTES
  ) {
    return { kind: "reject", message: OVERSIZED_FILE_REPLY };
  }

  try {
    const downloaded = await downloadTelegramFile(
      ctx,
      document.file_id,
      MAX_DOCUMENT_BYTES
    );

    const data = Buffer.from(downloaded.bytes).toString("base64");

    try {
      validateDocumentAttachments([{ data, filename, mediaType }]);
    } catch {
      return { kind: "reject", message: UNSUPPORTED_DOCUMENT_TYPES_REPLY };
    }

    // Base64 here is transport-only; the server persists bytes and stores document_ref in session history.
    return {
      input: {
        documents: [{ data, filename, mediaType }],
        message: ctx.message?.caption?.trim() ?? "",
      },
      kind: "input",
    };
  } catch (error) {
    if (error instanceof OversizedTelegramFileError) {
      return { kind: "reject", message: OVERSIZED_FILE_REPLY };
    }

    throw error;
  }
}

export function hasTelegramDocument(ctx: Context): boolean {
  return Boolean(ctx.message?.document);
}
