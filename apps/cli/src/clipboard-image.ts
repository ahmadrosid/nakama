import { getImageBinary, hasImage } from "@crosscopy/clipboard";
import {
  type ImageAttachment,
  MAX_IMAGE_BYTES,
  validateImageAttachments,
} from "@nakama/core";

export function detectClipboardImageMediaType(
  bytes: Uint8Array | Buffer
): ImageAttachment["mediaType"] {
  const eq = (sig: number[], off = 0) =>
    bytes.length >= off + sig.length &&
    sig.every((value, index) => bytes[off + index] === value);

  if (eq([0x89, 0x50, 0x4e, 0x47])) {
    return "image/png";
  }
  if (eq([0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  if (
    eq([0x47, 0x49, 0x46, 0x38]) &&
    (bytes[4] === 0x37 || bytes[4] === 0x39)
  ) {
    return "image/gif";
  }
  if (eq([0x52, 0x49, 0x46, 0x46]) && eq([0x57, 0x45, 0x42, 0x50], 8)) {
    return "image/webp";
  }

  throw new Error(
    "Unsupported clipboard image type. Allowed: jpeg, png, gif, webp."
  );
}

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
    mediaType: detectClipboardImageMediaType(bytes),
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
