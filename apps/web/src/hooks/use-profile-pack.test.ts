import { describe, expect, test } from "bun:test";
import { canConfirmProfilePackImport } from "./use-profile-pack";

describe("canConfirmProfilePackImport", () => {
  const file = new File(["zip"], "profile.zip", { type: "application/zip" });

  test("requires a file, ready preview, and no error or pending work", () => {
    expect(
      canConfirmProfilePackImport({
        hasPreviewError: false,
        pending: false,
        previewReady: true,
        selectedFile: file,
      })
    ).toBe(true);

    expect(
      canConfirmProfilePackImport({
        hasPreviewError: false,
        pending: false,
        previewReady: true,
        selectedFile: null,
      })
    ).toBe(false);

    expect(
      canConfirmProfilePackImport({
        hasPreviewError: false,
        pending: false,
        previewReady: false,
        selectedFile: file,
      })
    ).toBe(false);

    expect(
      canConfirmProfilePackImport({
        hasPreviewError: true,
        pending: false,
        previewReady: true,
        selectedFile: file,
      })
    ).toBe(false);

    expect(
      canConfirmProfilePackImport({
        hasPreviewError: false,
        pending: true,
        previewReady: true,
        selectedFile: file,
      })
    ).toBe(false);
  });
});
