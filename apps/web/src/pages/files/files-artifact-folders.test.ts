import { describe, expect, test } from "bun:test";
import type { ArtifactFile } from "@nakama/core/contract";
import {
  artifactBasename,
  artifactFolderFileLabel,
  artifactFolderSegments,
  listArtifactsInFolder,
  normalizeArtifactFolderPrefix,
} from "./files-artifact-folders";

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

describe("artifact path helpers", () => {
  test("strips slashes and normalizes separators", () => {
    expect(normalizeArtifactFolderPrefix("/coding-agent-runs/")).toBe(
      "coding-agent-runs"
    );
    expect(normalizeArtifactFolderPrefix("a\\b\\c")).toBe("a/b/c");
    expect(normalizeArtifactFolderPrefix("")).toBe("");
  });

  test("returns the last path segment as the display name", () => {
    expect(artifactBasename("notes.md")).toBe("notes.md");
    expect(
      artifactBasename("coding-agent-runs/2026-08-19T09-38-03-091Z-n40opv.log")
    ).toBe("2026-08-19T09-38-03-091Z-n40opv.log");
  });

  test("labels folder file counts", () => {
    expect(artifactFolderFileLabel(1)).toBe("1 file");
    expect(artifactFolderFileLabel(12)).toBe("12 files");
  });

  test("builds breadcrumb segments from a prefix", () => {
    expect(artifactFolderSegments("coding-agent-runs/nested")).toEqual([
      { name: "coding-agent-runs", prefix: "coding-agent-runs" },
      { name: "nested", prefix: "coding-agent-runs/nested" },
    ]);
    expect(artifactFolderSegments("")).toEqual([]);
  });
});

describe("listArtifactsInFolder", () => {
  test("groups root folders and keeps loose files", () => {
    const listing = listArtifactsInFolder(
      [
        artifact("coding-agent-runs/a.log", "2026-08-19T00:00:00.000Z"),
        artifact("coding-agent-runs/b.log", "2026-08-18T00:00:00.000Z"),
        artifact("notes.md"),
      ],
      ""
    );

    expect(listing.folders).toEqual([
      {
        fileCount: 2,
        latestUpdatedAt: "2026-08-19T00:00:00.000Z",
        name: "coding-agent-runs",
        prefix: "coding-agent-runs",
      },
    ]);
    expect(listing.files.map((file) => file.filename)).toEqual(["notes.md"]);
  });

  test("lists files and nested folders inside a prefix", () => {
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
    expect(listing.folders[0]?.fileCount).toBe(1);
  });

  test("sorts sibling folders by name", () => {
    const listing = listArtifactsInFolder(
      [artifact("zeta/a.txt"), artifact("alpha/b.txt")],
      ""
    );

    expect(listing.folders.map((folder) => folder.name)).toEqual([
      "alpha",
      "zeta",
    ]);
  });

  test("uses the newest nested file timestamp for a folder", () => {
    const listing = listArtifactsInFolder(
      [
        artifact("runs/old.log", "2026-08-01T00:00:00.000Z"),
        artifact("runs/nested/new.log", "2026-08-20T00:00:00.000Z"),
      ],
      ""
    );

    expect(listing.folders[0]?.latestUpdatedAt).toBe(
      "2026-08-20T00:00:00.000Z"
    );
    expect(listing.folders[0]?.fileCount).toBe(2);
  });

  test("ignores a file whose name matches the folder prefix", () => {
    const listing = listArtifactsInFolder(
      [artifact("coding-agent-runs"), artifact("coding-agent-runs/a.log")],
      "coding-agent-runs"
    );

    expect(listing.files.map((file) => file.filename)).toEqual([
      "coding-agent-runs/a.log",
    ]);
  });
});
