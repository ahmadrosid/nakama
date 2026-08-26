import { describe, expect, test } from "bun:test";
import { MAX_IMAGE_BYTES } from "@nakama/core";
import { attachmentFromClipboardBytes } from "./clipboard-image";

describe("attachmentFromClipboardBytes", () => {
  test("encodes small images without base64 ballooning first", () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const attachment = attachmentFromClipboardBytes(bytes);

    expect(attachment.mediaType).toBe("image/png");
    expect(attachment.data).toBe(bytes.toString("base64"));
  });

  test("rejects oversized clipboard payloads before base64 encode", () => {
    const bytes = Buffer.alloc(MAX_IMAGE_BYTES + 1);

    expect(() => attachmentFromClipboardBytes(bytes)).toThrow(
      /Clipboard image is too large/
    );
  });
});
