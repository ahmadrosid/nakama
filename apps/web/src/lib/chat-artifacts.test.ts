import { describe, expect, test } from "bun:test";
import type { ChatListItem } from "@/lib/chat-history";
import {
  extractArtifactPathsFromText,
  extractTurnArtifacts,
  inferArtifactMimeType,
  toArtifactsRelativePath,
} from "./chat-artifacts";

const ARTIFACTS_ROOT =
  "/Users/test/.nakama/orgs/org_1/profiles/profile_1/artifacts";

function writeFileTool(
  id: string,
  input: { path: string; content: string },
  result: { path: string; bytesWritten: number } | { error: string },
  toolStatus: "running" | "done" = "done"
): ChatListItem {
  return {
    content: "",
    id: `tool-${id}`,
    role: "tool",
    tool: "write_file",
    toolCallId: id,
    toolInput: input,
    toolResult: result,
    toolStatus,
  };
}

const metaJson = JSON.stringify({
  mimeType: "text/markdown",
  savedAt: "2026-07-13T10:00:00.000Z",
  sizeBytes: 42,
});

describe("extractTurnArtifacts", () => {
  test("pairs content and sidecar writes into one artifact ref", () => {
    const contentPath = `${ARTIFACTS_ROOT}/report.md`;
    const sidecarPath = `${ARTIFACTS_ROOT}/report.md.nakama-meta.json`;

    const messages: ChatListItem[] = [
      writeFileTool(
        "1",
        { content: "# Report", path: "artifacts/report.md" },
        {
          bytesWritten: 8,
          path: contentPath,
        }
      ),
      writeFileTool(
        "2",
        { content: metaJson, path: "artifacts/report.md.nakama-meta.json" },
        {
          bytesWritten: metaJson.length,
          path: sidecarPath,
        }
      ),
    ];

    expect(extractTurnArtifacts(messages)).toEqual([
      {
        filename: "report.md",
        mimeType: "text/markdown",
        path: "report.md",
        savedAt: "2026-07-13T10:00:00.000Z",
        sizeBytes: 42,
      },
    ]);
  });

  test("supports nested artifact paths", () => {
    const contentPath = `${ARTIFACTS_ROOT}/weekly/report.md`;
    const sidecarPath = `${ARTIFACTS_ROOT}/weekly/report.md.nakama-meta.json`;

    const messages: ChatListItem[] = [
      writeFileTool(
        "1",
        { content: "# Weekly", path: "artifacts/weekly/report.md" },
        {
          bytesWritten: 8,
          path: contentPath,
        }
      ),
      writeFileTool(
        "2",
        {
          content: metaJson,
          path: "artifacts/weekly/report.md.nakama-meta.json",
        },
        {
          bytesWritten: metaJson.length,
          path: sidecarPath,
        }
      ),
    ];

    expect(extractTurnArtifacts(messages)).toEqual([
      expect.objectContaining({
        filename: "report.md",
        path: "weekly/report.md",
      }),
    ]);
  });

  test("falls back to content-only writes with inferred mime", () => {
    const contentPath = `${ARTIFACTS_ROOT}/harness-engineering-slides.html`;

    expect(
      extractTurnArtifacts([
        writeFileTool(
          "1",
          {
            content: "<html></html>",
            path: "artifacts/harness-engineering-slides.html",
          },
          {
            bytesWritten: 13,
            path: contentPath,
          }
        ),
      ])
    ).toEqual([
      {
        filename: "harness-engineering-slides.html",
        mimeType: "text/html",
        path: "harness-engineering-slides.html",
        savedAt: "",
        sizeBytes: 13,
      },
    ]);
  });

  test("returns empty when only sidecar is written", () => {
    const sidecarPath = `${ARTIFACTS_ROOT}/report.md.nakama-meta.json`;

    expect(
      extractTurnArtifacts([
        writeFileTool(
          "1",
          { content: metaJson, path: "artifacts/report.md.nakama-meta.json" },
          {
            bytesWritten: metaJson.length,
            path: sidecarPath,
          }
        ),
      ])
    ).toEqual([]);
  });

  test("falls back to content write when sidecar write fails", () => {
    const contentPath = `${ARTIFACTS_ROOT}/report.md`;

    expect(
      extractTurnArtifacts([
        writeFileTool(
          "1",
          { content: "# Report", path: "artifacts/report.md" },
          {
            bytesWritten: 8,
            path: contentPath,
          }
        ),
        writeFileTool(
          "2",
          { content: metaJson, path: "artifacts/report.md.nakama-meta.json" },
          {
            error: "write failed",
          }
        ),
      ])
    ).toEqual([
      {
        filename: "report.md",
        mimeType: "text/markdown",
        path: "report.md",
        savedAt: "",
        sizeBytes: 8,
      },
    ]);
  });

  test("extracts artifact paths mentioned in assistant text", () => {
    expect(
      extractTurnArtifacts([
        {
          content:
            "Saved to `artifacts/harness-engineering-slides.html` for you.",
          id: "assistant-1",
          role: "assistant",
        },
      ])
    ).toEqual([
      {
        filename: "harness-engineering-slides.html",
        mimeType: "text/html",
        path: "harness-engineering-slides.html",
        savedAt: "",
        sizeBytes: 0,
      },
    ]);
  });

  test("prefers sidecar metadata over text mentions of the same path", () => {
    const contentPath = `${ARTIFACTS_ROOT}/report.md`;
    const sidecarPath = `${ARTIFACTS_ROOT}/report.md.nakama-meta.json`;

    expect(
      extractTurnArtifacts([
        writeFileTool(
          "1",
          { content: "# Report", path: "artifacts/report.md" },
          {
            bytesWritten: 8,
            path: contentPath,
          }
        ),
        writeFileTool(
          "2",
          { content: metaJson, path: "artifacts/report.md.nakama-meta.json" },
          {
            bytesWritten: metaJson.length,
            path: sidecarPath,
          }
        ),
        {
          content: "Saved `artifacts/report.md`.",
          id: "assistant-1",
          role: "assistant",
        },
      ])
    ).toEqual([
      {
        filename: "report.md",
        mimeType: "text/markdown",
        path: "report.md",
        savedAt: "2026-07-13T10:00:00.000Z",
        sizeBytes: 42,
      },
    ]);
  });

  test("falls back to content write when sidecar JSON is invalid", () => {
    const contentPath = `${ARTIFACTS_ROOT}/report.md`;
    const sidecarPath = `${ARTIFACTS_ROOT}/report.md.nakama-meta.json`;

    expect(
      extractTurnArtifacts([
        writeFileTool(
          "1",
          { content: "# Report", path: "artifacts/report.md" },
          {
            bytesWritten: 8,
            path: contentPath,
          }
        ),
        writeFileTool(
          "2",
          { content: "{bad", path: "artifacts/report.md.nakama-meta.json" },
          {
            bytesWritten: 4,
            path: sidecarPath,
          }
        ),
      ])
    ).toEqual([
      {
        filename: "report.md",
        mimeType: "text/markdown",
        path: "report.md",
        savedAt: "",
        sizeBytes: 8,
      },
    ]);
  });

  test("ignores meta files written outside artifacts", () => {
    const outsidePath =
      "/Users/test/.nakama/orgs/org_1/profiles/profile_1/notes.nakama-meta.json";

    expect(
      extractTurnArtifacts([
        writeFileTool(
          "1",
          { content: metaJson, path: "notes.nakama-meta.json" },
          {
            bytesWritten: metaJson.length,
            path: outsidePath,
          }
        ),
      ])
    ).toEqual([]);
  });

  test("emits two refs for two full pairs in one turn", () => {
    const messages: ChatListItem[] = [
      writeFileTool(
        "1",
        { content: "a", path: "artifacts/a.md" },
        {
          bytesWritten: 1,
          path: `${ARTIFACTS_ROOT}/a.md`,
        }
      ),
      writeFileTool(
        "2",
        { content: metaJson, path: "artifacts/a.md.nakama-meta.json" },
        {
          bytesWritten: metaJson.length,
          path: `${ARTIFACTS_ROOT}/a.md.nakama-meta.json`,
        }
      ),
      writeFileTool(
        "3",
        { content: "b", path: "artifacts/b.md" },
        {
          bytesWritten: 1,
          path: `${ARTIFACTS_ROOT}/b.md`,
        }
      ),
      writeFileTool(
        "4",
        { content: metaJson, path: "artifacts/b.md.nakama-meta.json" },
        {
          bytesWritten: metaJson.length,
          path: `${ARTIFACTS_ROOT}/b.md.nakama-meta.json`,
        }
      ),
    ];

    expect(extractTurnArtifacts(messages)).toHaveLength(2);
  });

  test("emits artifacts-relative paths only", () => {
    const contentPath = `${ARTIFACTS_ROOT}/weekly/report.md`;

    const [artifact] = extractTurnArtifacts([
      writeFileTool(
        "1",
        { content: "# Weekly", path: "artifacts/weekly/report.md" },
        {
          bytesWritten: 8,
          path: contentPath,
        }
      ),
      writeFileTool(
        "2",
        {
          content: metaJson,
          path: "artifacts/weekly/report.md.nakama-meta.json",
        },
        {
          bytesWritten: metaJson.length,
          path: `${ARTIFACTS_ROOT}/weekly/report.md.nakama-meta.json`,
        }
      ),
    ]);

    expect(artifact?.path).toBe("weekly/report.md");
    expect(artifact?.path.startsWith("/")).toBe(false);
  });

  test("extracts successful generate_image tool results without write_file pairs", () => {
    expect(
      extractTurnArtifacts([
        {
          content: "",
          id: "tool-img",
          role: "tool",
          tool: "generate_image",
          toolCallId: "img_1",
          toolInput: { prompt: "a cat" },
          toolResult: {
            attachmentId: "att_1",
            mimeType: "image/png",
            model: "gpt-image-2",
            path: "artifacts/cat.png",
            sizeBytes: 2048,
          },
          toolStatus: "done",
        },
      ])
    ).toEqual([
      {
        filename: "cat.png",
        mimeType: "image/png",
        path: "cat.png",
        savedAt: "",
        sizeBytes: 2048,
      },
    ]);
  });

  test("ignores failed generate_image tool results", () => {
    expect(
      extractTurnArtifacts([
        {
          content: "",
          id: "tool-img",
          role: "tool",
          tool: "generate_image",
          toolCallId: "img_1",
          toolInput: { prompt: "a cat" },
          toolResult: { error: "Image model is not configured." },
          toolStatus: "done",
        },
      ])
    ).toEqual([]);
  });

  test("rejects generate_image results missing mimeType", () => {
    expect(
      extractTurnArtifacts([
        {
          content: "",
          id: "tool-img",
          role: "tool",
          tool: "generate_image",
          toolCallId: "img_1",
          toolInput: { prompt: "a cat" },
          toolResult: {
            path: "artifacts/cat.png",
            sizeBytes: 2048,
          },
          toolStatus: "done",
        },
      ])
    ).toEqual([]);
  });

  test("extracts write_file pairs and generate_image together in one turn", () => {
    const messages: ChatListItem[] = [
      writeFileTool(
        "1",
        { content: "a", path: "artifacts/a.md" },
        {
          bytesWritten: 1,
          path: `${ARTIFACTS_ROOT}/a.md`,
        }
      ),
      writeFileTool(
        "2",
        { content: metaJson, path: "artifacts/a.md.nakama-meta.json" },
        {
          bytesWritten: metaJson.length,
          path: `${ARTIFACTS_ROOT}/a.md.nakama-meta.json`,
        }
      ),
      {
        content: "",
        id: "tool-img",
        role: "tool",
        tool: "generate_image",
        toolCallId: "img_1",
        toolInput: { prompt: "a cat" },
        toolResult: {
          attachmentId: "att_1",
          mimeType: "image/png",
          model: "gpt-image-2",
          path: "artifacts/cat.png",
          sizeBytes: 2048,
        },
        toolStatus: "done",
      },
    ];

    expect(
      extractTurnArtifacts(messages)
        .map((artifact) => artifact.path)
        .sort()
    ).toEqual(["a.md", "cat.png"]);
  });
});

describe("toArtifactsRelativePath", () => {
  test("strips the artifacts directory prefix", () => {
    expect(toArtifactsRelativePath(`${ARTIFACTS_ROOT}/weekly/report.md`)).toBe(
      "weekly/report.md"
    );
  });

  test("supports relative artifacts paths", () => {
    expect(toArtifactsRelativePath("artifacts/weekly/report.md")).toBe(
      "weekly/report.md"
    );
  });
});

describe("extractArtifactPathsFromText", () => {
  test("finds inline artifact paths", () => {
    expect(
      extractArtifactPathsFromText(
        "Open artifacts/harness-engineering-slides.html when ready."
      )
    ).toEqual(["harness-engineering-slides.html"]);
  });

  test("ignores meta sidecars", () => {
    expect(
      extractArtifactPathsFromText("artifacts/report.md.nakama-meta.json")
    ).toEqual([]);
  });
});

describe("inferArtifactMimeType", () => {
  test("maps common extensions", () => {
    expect(inferArtifactMimeType("slides.html")).toBe("text/html");
    expect(inferArtifactMimeType("notes.md")).toBe("text/markdown");
    expect(inferArtifactMimeType("data.json")).toBe("application/json");
  });
});
