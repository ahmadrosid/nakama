import { describe, expect, test } from "bun:test";
import { scaleImageDimensions } from "./compress-image";

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
