import { describe, expect, test } from "bun:test";
import {
  COMPRESS_IMAGE_OVER_BYTES,
  compressImageFileForUpload,
  scaleImageDimensions,
} from "./compress-image";

describe("compressImageFileForUpload", () => {
  test("leaves images at or under 1 MB unchanged", async () => {
    const file = new File(
      [new Uint8Array(COMPRESS_IMAGE_OVER_BYTES)],
      "shot.png",
      { type: "image/png" }
    );

    expect(await compressImageFileForUpload(file)).toBe(file);
  });

  test("leaves non-images unchanged when larger than 1 MB", async () => {
    const file = new File(
      [new Uint8Array(COMPRESS_IMAGE_OVER_BYTES + 1)],
      "notes.pdf",
      { type: "application/pdf" }
    );

    expect(await compressImageFileForUpload(file)).toBe(file);
  });
});

describe("scaleImageDimensions", () => {
  test("keeps dimensions when already within bounds", () => {
    expect(scaleImageDimensions(800, 600, 2048)).toEqual({
      height: 600,
      width: 800,
    });
  });

  test("scales down to max dimension", () => {
    expect(scaleImageDimensions(4096, 2048, 2048)).toEqual({
      height: 1024,
      width: 2048,
    });
  });

  test("applies additional scale factor", () => {
    expect(scaleImageDimensions(1600, 1200, 2048, 0.5)).toEqual({
      height: 600,
      width: 800,
    });
  });
});
