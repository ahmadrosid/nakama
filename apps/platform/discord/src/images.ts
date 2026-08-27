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

export const OVERSIZED_IMAGE_REPLY =
  "Image is too large. Maximum size is 5 MB.";

export const TOO_MANY_IMAGES_REPLY = `At most ${MAX_ATTACHMENTS_PER_MESSAGE} images per message.`;

export const UNSUPPORTED_ATTACHMENT_REPLY =
  "Unsupported attachment. Send a jpeg, png, gif, or webp image (max 5 MB).";

export const DOWNLOAD_FAILED_REPLY =
  "Could not download that image. Try again.";

interface DiscordImageInput {
  images: ImageAttachment[];
  message: string;
}

export type DiscordImageBuildResult =
  | { kind: "input"; input: DiscordImageInput }
  | { kind: "reject"; message: string }
  | null;

export async function buildDiscordImageInput(
  message: Message
): Promise<DiscordImageBuildResult> {
  const attachments = [...(message.attachments?.values() ?? [])];

  if (attachments.length === 0) {
    return null;
  }

  const valid: Attachment[] = [];
  let sawOversizedImage = false;

  for (const attachment of attachments) {
    const mediaType = resolveAttachmentMediaType(attachment);

    if (!ALLOWED_IMAGE_MEDIA_TYPES.has(mediaType)) {
      continue;
    }

    if (attachment.size > MAX_IMAGE_BYTES) {
      sawOversizedImage = true;
      continue;
    }

    valid.push(attachment);
  }

  if (valid.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    return { kind: "reject", message: TOO_MANY_IMAGES_REPLY };
  }

  if (valid.length === 0) {
    if (sawOversizedImage) {
      return { kind: "reject", message: OVERSIZED_IMAGE_REPLY };
    }

    // Non-image attachments with caption/text: ignore files and let the text path run.
    if (message.content?.trim()) {
      return null;
    }

    return { kind: "reject", message: UNSUPPORTED_ATTACHMENT_REPLY };
  }

  try {
    const images: ImageAttachment[] = [];

    for (const attachment of valid) {
      images.push(await downloadDiscordImage(attachment));
    }

    validateImageAttachments(images);

    return {
      input: {
        images,
        message: message.content?.trim() ?? "",
      },
      kind: "input",
    };
  } catch (error) {
    if (error instanceof Error && /too large/i.test(error.message)) {
      return { kind: "reject", message: OVERSIZED_IMAGE_REPLY };
    }

    return { kind: "reject", message: DOWNLOAD_FAILED_REPLY };
  }
}

function resolveAttachmentMediaType(attachment: Attachment): string {
  const rawContentType = attachment.contentType?.trim() ?? "";

  if (rawContentType) {
    const fromHeader = normalizeMimeType(rawContentType);

    if (ALLOWED_IMAGE_MEDIA_TYPES.has(fromHeader)) {
      return fromHeader;
    }

    // Explicit non-image content type — do not override from filename.
    return "";
  }

  return inferMediaTypeFromName(attachment.name ?? "");
}

function inferMediaTypeFromName(name: string): string {
  const extension = name.slice(name.lastIndexOf(".")).toLowerCase();

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
      return "";
  }
}

async function downloadDiscordImage(
  attachment: Attachment
): Promise<ImageAttachment> {
  const mediaType = resolveAttachmentMediaType(attachment);

  if (attachment.size > MAX_IMAGE_BYTES) {
    throw new Error(OVERSIZED_IMAGE_REPLY);
  }

  const response = await fetch(attachment.url);

  if (!response.ok) {
    throw new Error(`Failed to download image (${response.status}).`);
  }

  const bytes = await response.arrayBuffer();

  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(OVERSIZED_IMAGE_REPLY);
  }

  return {
    data: Buffer.from(bytes).toString("base64"),
    mediaType,
  };
}
