import { describe, expect, test } from "bun:test";
import {
  shouldClearInitialPreviewDedupe,
  shouldStartInitialFilePreview,
} from "./use-data-portability";

describe("shouldStartInitialFilePreview", () => {
  const file = new File(["zip"], "nakama.zip", { type: "application/zip" });
  const other = new File(["zip"], "other.zip", { type: "application/zip" });

  test("starts once per File identity and resets when cleared", () => {
    expect(shouldStartInitialFilePreview(null, null)).toBe(false);
    expect(shouldStartInitialFilePreview(file, null)).toBe(true);
    expect(shouldStartInitialFilePreview(file, file)).toBe(false);
    expect(shouldStartInitialFilePreview(other, file)).toBe(true);
    expect(shouldStartInitialFilePreview(null, file)).toBe(false);
  });
});

describe("shouldClearInitialPreviewDedupe", () => {
  test("only the current generation clears the dedupe key", () => {
    expect(shouldClearInitialPreviewDedupe(1, 1)).toBe(true);
    expect(shouldClearInitialPreviewDedupe(1, 2)).toBe(false);
    expect(shouldClearInitialPreviewDedupe(2, 2)).toBe(true);
  });
});
