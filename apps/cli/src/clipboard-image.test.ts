import { describe, expect, spyOn, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as nativeClipboard from "@crosscopy/clipboard";
import { MAX_IMAGE_BYTES } from "@nakama/core";
import {
  attachmentFromClipboardBytes,
  detectClipboardImageMediaType,
  pastedImagePath,
  readClipboardImage,
} from "./clipboard-image";

test("recognizes terminal image paths without treating prose as a path", () => {
  for (const input of [
    "/tmp/screen shot.png",
    '"/tmp/screen shot.png"',
    "'/tmp/screen shot.png'",
    "/tmp/screen\\ shot.png",
    "file:///tmp/screen%20shot.png",
  ]) {
    expect(pastedImagePath(input)).toBe("/tmp/screen shot.png");
  }
  expect(pastedImagePath("describe /tmp/image.png")).toBeNull();
  expect(pastedImagePath("/tmp/notes.txt")).toBeNull();
  expect(pastedImagePath("/tmp/a.png\n/tmp/b.png")).toBeNull();
});

test.each([
  tmpdir(),
  ...(process.platform === "darwin"
    ? [
        execFileSync("/usr/bin/getconf", ["DARWIN_USER_TEMP_DIR"], {
          encoding: "utf8",
        }).trim(),
      ]
    : []),
])(
  "reads copied files and terminal-created images in %s",
  async (temporaryDir) => {
    const dir = await mkdtemp(join(temporaryDir, "nakama-paste-"));
    const filePath = join(dir, "screen shot.png");
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const hasFiles = spyOn(nativeClipboard, "hasFiles").mockReturnValue(true);
    const getFiles = spyOn(nativeClipboard, "getFiles").mockResolvedValue([
      filePath,
    ]);
    try {
      await writeFile(filePath, bytes);
      const image = { data: bytes.toString("base64"), mediaType: "image/png" };
      expect(await readClipboardImage(filePath)).toEqual(image);
      expect(await readClipboardImage()).toEqual(image);
      hasFiles.mockReturnValue(false);
      expect(await readClipboardImage(filePath)).toEqual(image);
      await writeFile(filePath, "not an image");
      await expect(readClipboardImage(filePath)).rejects.toThrow();
      await truncate(filePath, MAX_IMAGE_BYTES + 1);
      await expect(readClipboardImage(filePath)).rejects.toThrow();
      const link = join(dir, "outside.png");
      await symlink("/etc/hosts", link);
      await expect(readClipboardImage(link)).rejects.toThrow();
    } finally {
      hasFiles.mockRestore();
      getFiles.mockRestore();
      await rm(dir, { force: true, recursive: true });
    }
  }
);

describe("detectClipboardImageMediaType", () => {
  test("detects png/jpeg/gif/webp magic bytes", () => {
    expect(
      detectClipboardImageMediaType(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      )
    ).toBe("image/png");

    expect(
      detectClipboardImageMediaType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))
    ).toBe("image/jpeg");

    expect(detectClipboardImageMediaType(Buffer.from("GIF89a", "ascii"))).toBe(
      "image/gif"
    );

    const webp = Buffer.alloc(12);
    webp.write("RIFF", 0, "ascii");
    webp.write("WEBP", 8, "ascii");
    expect(detectClipboardImageMediaType(webp)).toBe("image/webp");
  });

  test("rejects unknown signatures", () => {
    expect(() =>
      detectClipboardImageMediaType(Buffer.from("not-an-image"))
    ).toThrow(/Unsupported clipboard image type/);
  });
});

describe("attachmentFromClipboardBytes", () => {
  test("encodes small images with detected media type", () => {
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
