import { describe, expect, test } from "bun:test";
import {
  modelListRowVisionEnabled,
  normalizeModelListRows,
} from "./model-list-editor.shared";

describe("modelListRowVisionEnabled", () => {
  test("defaults on unless explicitly disabled", () => {
    expect(modelListRowVisionEnabled({}, true)).toBe(true);
    expect(modelListRowVisionEnabled({ supportsVision: true }, true)).toBe(
      true
    );
    expect(modelListRowVisionEnabled({ supportsVision: false }, true)).toBe(
      false
    );
  });

  test("defaults off unless explicitly enabled", () => {
    expect(modelListRowVisionEnabled({}, false)).toBe(false);
    expect(modelListRowVisionEnabled({ supportsVision: true }, false)).toBe(
      true
    );
    expect(modelListRowVisionEnabled({ supportsVision: false }, false)).toBe(
      false
    );
  });
});

describe("normalizeModelListRows context sizes", () => {
  test("forwards the sizes and drops blank ones", () => {
    expect(
      normalizeModelListRows([
        { contextWindow: 200_000, id: "a", maxOutputTokens: 16_384 },
        { id: "b" },
      ])
    ).toEqual([
      { contextWindow: 200_000, id: "a", maxOutputTokens: 16_384 },
      { id: "b" },
    ]);
  });
});
