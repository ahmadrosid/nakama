import { describe, expect, test } from "bun:test";
import {
  canPreviewWorkspaceEntry,
  legacyArtifactProfileId,
  parseFilesViewMode,
  resolveFilesProfileId,
} from "./files-page.shared";

const profiles = [{ id: "default" }, { id: "other" }];

describe("Files profile resolution", () => {
  test("falls back to default then first profile", () => {
    expect(
      resolveFilesProfileId({ activeProfileId: "missing", profiles })
    ).toBe("default");
    expect(resolveFilesProfileId({ profiles: [{ id: "other" }] })).toBe(
      "other"
    );
    expect(resolveFilesProfileId({ profiles: [] })).toBeNull();
  });

  test("only preserves a valid legacy artifact profile", () => {
    expect(
      legacyArtifactProfileId("tab=artifacts&profile=other", profiles)
    ).toBe("other");
    expect(
      legacyArtifactProfileId("tab=artifacts&profile=missing", profiles)
    ).toBeNull();
  });
});

describe("Files view mode", () => {
  test("accepts list and grid only", () => {
    expect(parseFilesViewMode("list")).toBe("list");
    expect(parseFilesViewMode("grid")).toBe("grid");
    expect(parseFilesViewMode("table")).toBeNull();
    expect(parseFilesViewMode("")).toBeNull();
    expect(parseFilesViewMode(null)).toBeNull();
    expect(parseFilesViewMode(undefined)).toBeNull();
  });
});

describe("canPreviewWorkspaceEntry", () => {
  const base = {
    isImage: false,
    isPdf: false,
    isText: false,
    isVideo: false,
    isWordDocument: false,
    sizeBytes: 1024,
  };
  const OVER_CAP = 12 * 1024 * 1024;

  test("a Word document is not capped, because the payload is the conversion", () => {
    expect(
      canPreviewWorkspaceEntry({
        ...base,
        isText: true,
        isWordDocument: true,
        sizeBytes: OVER_CAP,
      })
    ).toBe(true);
  });

  test("everything served raw is still capped", () => {
    for (const kind of ["isImage", "isPdf", "isText", "isVideo"] as const) {
      expect(
        canPreviewWorkspaceEntry({ ...base, [kind]: true, sizeBytes: OVER_CAP })
      ).toBe(false);
    }
  });

  test("a small Word document is unchanged", () => {
    expect(
      canPreviewWorkspaceEntry({ ...base, isText: true, isWordDocument: true })
    ).toBe(true);
  });

  test("a type with no preview stays unpreviewable whatever its size", () => {
    expect(canPreviewWorkspaceEntry(base)).toBe(false);
    expect(canPreviewWorkspaceEntry({ ...base, isWordDocument: true })).toBe(
      false
    );
  });
});
