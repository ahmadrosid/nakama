import { describe, expect, test } from "bun:test";
import {
  canRestoreDataImport,
  formatDataPortabilityBytes,
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
      canRestoreDataImport({ selectedFile: file, previewReady: true, pending: false }),
    ).toBe(true);
    expect(
      canRestoreDataImport({ selectedFile: null, previewReady: true, pending: false }),
    ).toBe(false);
    expect(
      canRestoreDataImport({ selectedFile: file, previewReady: false, pending: false }),
    ).toBe(false);
    expect(
      canRestoreDataImport({ selectedFile: file, previewReady: true, pending: true }),
    ).toBe(false);
  });
});
