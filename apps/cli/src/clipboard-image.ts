import { getImageBinary, hasImage } from "@crosscopy/clipboard";
import type { ImageAttachment } from "@nakama/core";
import { validateImageAttachments } from "@nakama/core";

export function isClipboardImagePasteSupported(): boolean {
  return true;
}

export async function readClipboardImage(): Promise<ImageAttachment | null> {
  if (!hasImage()) {
    return null;
  }

  const bytes = await getImageBinary();

  if (!bytes?.length) {
    return null;
  }

  const attachment: ImageAttachment = {
    mediaType: "image/png",
    data: Buffer.from(bytes).toString("base64"),
  };

  validateImageAttachments([attachment]);
  return attachment;
}
