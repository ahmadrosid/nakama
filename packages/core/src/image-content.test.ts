import { describe, expect, test } from "bun:test";
import {
  extractImageParts,
  replaceImagePartsWithDescriptions,
} from "./image-content";

const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("extractImageParts", () => {
  test("returns empty array for plain text", () => {
    expect(extractImageParts("hello")).toEqual([]);
  });

  test("extracts image parts from content array", () => {
    const parts = extractImageParts([
      { type: "text", text: "What is this?" },
      { type: "image", mediaType: "image/png", data: tinyPngBase64 },
    ]);

    expect(parts).toHaveLength(1);
    expect(parts[0]?.mediaType).toBe("image/png");
  });
});

describe("replaceImagePartsWithDescriptions", () => {
  test("replaces image parts with text descriptions", () => {
    const result = replaceImagePartsWithDescriptions(
      [
        { type: "text", text: "What is this?" },
        { type: "image", mediaType: "image/png", data: tinyPngBase64 },
      ],
      ["A red square on white background."],
    );

    expect(result).toEqual([
      { type: "text", text: "What is this?" },
      { type: "text", text: "[Image]\nA red square on white background." },
    ]);
  });

  test("returns plain string when only image descriptions remain", () => {
    const result = replaceImagePartsWithDescriptions(
      [{ type: "image", mediaType: "image/png", data: tinyPngBase64 }],
      ["A chart with three bars."],
    );

    expect(result).toBe("[Image]\nA chart with three bars.");
  });
});
