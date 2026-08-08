import { describe, expect, test } from "bun:test";
import {
  canRestoreDataImport,
  formatDataPortabilityBytes,
  shouldStartInitialFilePreview,
} from "./use-data-portability";

describe("formatDataPortabilityBytes", () => {
  test("formats byte counts for data import preview", () => {
    expect(formatDataPortabilityBytes(42)).toBe("42 B");
    expect(formatDataPortabilityBytes(1536)).toBe("1.5 KB");
    expect(formatDataPortabilityBytes(12 * 1024 * 1024)).toBe("12 MB");
  });
});

describe("canRestoreDataImport", () => {
  const file = new File(["zip"], "nakama.zip", { type: "application/zip" });

  test("requires a selected file, successful preview, and idle restore state", () => {
    expect(
      canRestoreDataImport({
        pending: false,
        previewReady: true,
        selectedFile: file,
      })
    ).toBe(true);
    expect(
      canRestoreDataImport({
        pending: false,
        previewReady: true,
        selectedFile: null,
      })
    ).toBe(false);
    expect(
      canRestoreDataImport({
        pending: false,
        previewReady: false,
        selectedFile: file,
      })
    ).toBe(false);
    expect(
      canRestoreDataImport({
        pending: true,
        previewReady: true,
        selectedFile: file,
      })
    ).toBe(false);
  });
});

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
