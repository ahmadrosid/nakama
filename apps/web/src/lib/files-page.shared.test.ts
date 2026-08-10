import { describe, expect, test } from "bun:test";
import {
  legacyArtifactProfileId,
  parseFilesViewMode,
  resolveFilesProfileId,
} from "./files-page.shared";

const profiles = [{ id: "default" }, { id: "other" }];

describe("Files profile resolution", () => {
  test("keeps a known active profile", () => {
    expect(resolveFilesProfileId({ activeProfileId: "other", profiles })).toBe(
      "other"
    );
  });

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
