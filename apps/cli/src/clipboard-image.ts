import { getImageBinary, hasImage } from "@crosscopy/clipboard";
import {
  type ImageAttachment,
  MAX_IMAGE_BYTES,
  NakamaApiError,
  validateImageAttachments,
} from "@nakama/core";

export async function readClipboardImage(): Promise<ImageAttachment | null> {
  if (!hasImage()) {
    return null;
  }

  const bytes = await getImageBinary();

  if (!bytes?.length) {
    return null;
  }

  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new NakamaApiError(
      `Each image must be at most ${MAX_IMAGE_BYTES / (1024 * 1024)} MB.`,
      400
    );
  }

  const attachment: ImageAttachment = {
    data: Buffer.from(bytes).toString("base64"),
    mediaType: "image/png",
  };

  validateImageAttachments([attachment]);
  return attachment;
}
