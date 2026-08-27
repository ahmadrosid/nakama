import { normalizeMimeType } from "@nakama/core/artifact-mime";
import type { ImageAttachment } from "@nakama/core/contract";
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_IMAGE_BYTES,
  validateImageAttachments,
} from "@nakama/core/message-content";
import type { Attachment, Message } from "discord.js";

const ALLOWED_IMAGE_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

export interface DiscordImageInput {
  images: ImageAttachment[];
  message: string;
}

export async function buildDiscordImageInput(
  message: Message
): Promise<DiscordImageInput | null> {
  const attachments = [...(message.attachments?.values() ?? [])]
    .filter(isAllowedImageAttachment)
    .slice(0, MAX_ATTACHMENTS_PER_MESSAGE);

  if (attachments.length === 0) {
    return null;
  }

  const images: ImageAttachment[] = [];

  for (const attachment of attachments) {
    images.push(await downloadDiscordImage(attachment));
  }

  validateImageAttachments(images);

  return {
    images,
    message: message.content?.trim() ?? "",
  };
}

function isAllowedImageAttachment(attachment: Attachment): boolean {
  return ALLOWED_IMAGE_MEDIA_TYPES.has(
    normalizeMimeType(attachment.contentType ?? "")
  );
}

async function downloadDiscordImage(
  attachment: Attachment
): Promise<ImageAttachment> {
  const mediaType = normalizeMimeType(attachment.contentType ?? "");

  if (attachment.size > MAX_IMAGE_BYTES) {
    throw new Error("Image is too large. Maximum size is 5 MB.");
  }

  const response = await fetch(attachment.url);

  if (!response.ok) {
    throw new Error(`Failed to download image (${response.status}).`);
  }

  const bytes = await response.arrayBuffer();

  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error("Image is too large. Maximum size is 5 MB.");
  }

  return {
    data: Buffer.from(bytes).toString("base64"),
    mediaType,
  };
}
