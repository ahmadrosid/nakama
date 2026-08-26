import { getImageBinary, hasImage } from "@crosscopy/clipboard";
import {
  type ImageAttachment,
  MAX_IMAGE_BYTES,
  validateImageAttachments,
} from "@nakama/core";

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
    mediaType: "image/png",
  };
}

export async function readClipboardImage(): Promise<ImageAttachment | null> {
  if (!hasImage()) {
    return null;
  }

  const bytes = await getImageBinary();

  if (!bytes?.length) {
    return null;
  }

  const attachment = attachmentFromClipboardBytes(bytes);
  validateImageAttachments([attachment]);
  return attachment;
}
