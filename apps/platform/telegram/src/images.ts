import type { Context } from "grammy";
import type { ImageAttachment } from "@tinyclaw/core/contract";
import { MAX_IMAGE_BYTES } from "@tinyclaw/core/message-content";
import { downloadTelegramFile, OversizedTelegramFileError } from "./attachments";

export interface TelegramImageInput {
  message: string;
  images: ImageAttachment[];
}

export async function buildTelegramImageInput(ctx: Context): Promise<TelegramImageInput | null> {
  const photos = ctx.message?.photo;

  if (photos?.length) {
    const largest = photos[photos.length - 1]!;

    return {
      message: ctx.message?.caption?.trim() ?? "",
      images: [await downloadTelegramImage(ctx, largest.file_id)],
    };
  }

  const document = ctx.message?.document;

  if (document?.mime_type?.startsWith("image/")) {
    return {
      message: ctx.message?.caption?.trim() ?? "",
      images: [await downloadTelegramImage(ctx, document.file_id)],
    };
  }

  return null;
}

export async function downloadTelegramImage(
  ctx: Context,
  fileId: string,
): Promise<ImageAttachment> {
  try {
    const downloaded = await downloadTelegramFile(ctx, fileId, MAX_IMAGE_BYTES);
    const mediaType = inferMediaType(downloaded.filePath, downloaded.contentType);

    // Base64 here is transport-only; the server persists bytes and stores image_ref in session history.
    return {
      mediaType,
      data: Buffer.from(downloaded.bytes).toString("base64"),
    };
  } catch (error) {
    if (error instanceof OversizedTelegramFileError) {
      throw new Error("Image is too large. Maximum size is 5 MB.");
    }

    throw error;
  }
}

function inferMediaType(filePath: string, headerType: string | null): string {
  if (headerType?.startsWith("image/")) {
    return headerType.split(";")[0]!.trim();
  }

  const extension = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();

  switch (extension) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    default:
      return "image/jpeg";
  }
}
