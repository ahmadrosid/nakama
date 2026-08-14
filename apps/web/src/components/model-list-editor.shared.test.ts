import { describe, expect, test } from "bun:test";
import { modelListRowVisionEnabled } from "./model-list-editor.shared";

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
