import { describe, expect, test } from "bun:test";
import type { ArtifactFile } from "@nakama/core/contract";
import { listArtifactsInFolder } from "./files-artifact-folders";

function artifact(
  filename: string,
  updatedAt = "2026-08-19T00:00:00.000Z"
): ArtifactFile {
  return {
    filename,
    mimeType: "text/plain",
    path: `/tmp/${filename}`,
    sizeBytes: 1,
    updatedAt,
  };
}

describe("listArtifactsInFolder", () => {
  test("groups nested paths at the root", () => {
    const listing = listArtifactsInFolder(
      [
        artifact("zeta/old.log", "2026-08-01T00:00:00.000Z"),
        artifact("zeta/nested/new.log", "2026-08-20T00:00:00.000Z"),
        artifact("coding-agent-runs/a.log"),
        artifact("notes.md"),
      ],
      ""
    );

    expect(listing.folders.map((folder) => folder.name)).toEqual([
      "coding-agent-runs",
      "zeta",
    ]);
    expect(listing.folders[1]?.fileCount).toBe(2);
    expect(listing.folders[1]?.latestUpdatedAt).toBe(
      "2026-08-20T00:00:00.000Z"
    );
    expect(listing.files.map((file) => file.filename)).toEqual(["notes.md"]);
  });

  test("scopes to the current folder", () => {
    const listing = listArtifactsInFolder(
      [
        artifact("coding-agent-runs/a.log"),
        artifact("coding-agent-runs/nested/b.log"),
        artifact("other/c.log"),
      ],
      "coding-agent-runs"
    );

    expect(listing.files.map((file) => file.filename)).toEqual([
      "coding-agent-runs/a.log",
    ]);
    expect(listing.folders.map((folder) => folder.name)).toEqual(["nested"]);
  });
});
