import { describe, expect, mock, test } from "bun:test";
import { MAX_IMAGE_BYTES, type NakamaApiError } from "@nakama/core";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

let hasImageResult = false;
let imageBytes: Uint8Array | null = null;

mock.module("@crosscopy/clipboard", () => ({
  getImageBinary: async () => imageBytes,
  hasImage: () => hasImageResult,
}));

const { readClipboardImage } = await import("./clipboard-image");

describe("readClipboardImage", () => {
  test("returns null when clipboard has no image", async () => {
    hasImageResult = false;
    imageBytes = null;

    expect(await readClipboardImage()).toBeNull();
  });

  test("returns a validated attachment for a small clipboard image", async () => {
    hasImageResult = true;
    imageBytes = new Uint8Array(tinyPng);

    expect(await readClipboardImage()).toEqual({
      data: tinyPng.toString("base64"),
      mediaType: "image/png",
    });
  });

  test("rejects oversized clipboard bytes before base64 encoding", async () => {
    hasImageResult = true;
    imageBytes = new Uint8Array(MAX_IMAGE_BYTES + 1);

    await expect(readClipboardImage()).rejects.toMatchObject({
      message: `Each image must be at most ${MAX_IMAGE_BYTES / (1024 * 1024)} MB.`,
      name: "NakamaApiError",
      status: 400,
    } satisfies Partial<NakamaApiError>);
  });
});
