import { describe, expect, test } from "bun:test";
import type { ArtifactFile } from "@nakama/core/contract";
import {
  artifactMatchesTypeFilter,
  availableArtifactTypeFilters,
  classifyArtifactType,
} from "./artifacts-tab-filters";

function artifact(
  partial: Partial<ArtifactFile> & Pick<ArtifactFile, "filename" | "mimeType">
): ArtifactFile {
  return {
    path: `/tmp/${partial.filename}`,
    sizeBytes: 0,
    updatedAt: "2026-08-02T00:00:00.000Z",
    ...partial,
  };
}

describe("classifyArtifactType", () => {
  test("classifies common artifact families", () => {
    expect(
      classifyArtifactType(
        artifact({ filename: "notes.md", mimeType: "text/markdown" })
      )
    ).toBe("markdown");
    expect(
      classifyArtifactType(
        artifact({ filename: "page.html", mimeType: "text/html" })
      )
    ).toBe("html");
    expect(
      classifyArtifactType(
        artifact({ filename: "shot.png", mimeType: "image/png" })
      )
    ).toBe("image");
    expect(
      classifyArtifactType(
        artifact({ filename: "reel.mp4", mimeType: "application/octet-stream" })
      )
    ).toBe("video");
    expect(
      classifyArtifactType(
        artifact({
          filename: "brief.docx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        })
      )
    ).toBe("document");
    expect(
      classifyArtifactType(
        artifact({ filename: "log.txt", mimeType: "text/plain" })
      )
    ).toBe("text");
    expect(
      classifyArtifactType(
        artifact({ filename: "blob.bin", mimeType: "application/octet-stream" })
      )
    ).toBe("other");
  });
});

describe("artifactMatchesTypeFilter", () => {
  test("all matches everything; specific filters narrow", () => {
    const video = artifact({ filename: "reel.mp4", mimeType: "video/mp4" });
    expect(artifactMatchesTypeFilter(video, "all")).toBe(true);
    expect(artifactMatchesTypeFilter(video, "video")).toBe(true);
    expect(artifactMatchesTypeFilter(video, "markdown")).toBe(false);
  });
});

describe("availableArtifactTypeFilters", () => {
  test("only includes types present in the list", () => {
    expect(
      availableArtifactTypeFilters([
        artifact({ filename: "a.md", mimeType: "text/markdown" }),
        artifact({ filename: "b.mp4", mimeType: "video/mp4" }),
        artifact({ filename: "c.md", mimeType: "text/markdown" }),
      ])
    ).toEqual(["all", "markdown", "video"]);
  });
});
