import { describe, expect, test } from "bun:test";
import { parseStreamingArtifactToolInput } from "./streaming-artifact-input";

describe("parseStreamingArtifactToolInput", () => {
  test("returns eligible write_file artifact with path and content", () => {
    expect(
      parseStreamingArtifactToolInput(
        "write_file",
        '{"path":"artifacts/report.md","content":"# Report\\n"}'
      )
    ).toEqual({
      content: "# Report\n",
      eligible: true,
      filename: "report.md",
      relativePath: "report.md",
    });
  });

  test("returns markdown content for write_docx", () => {
    expect(
      parseStreamingArtifactToolInput(
        "write_docx",
        '{"path":"artifacts/report.docx","markdown":"# Title"}'
      )
    ).toEqual({
      content: "# Title",
      eligible: true,
      filename: "report.docx",
      relativePath: "report.docx",
    });
  });

  test("returns content before path is known", () => {
    expect(
      parseStreamingArtifactToolInput("write_file", '{"content":"# Partial"')
    ).toEqual({
      content: "# Partial",
      eligible: false,
      filename: null,
      relativePath: null,
    });
  });

  test("decodes split unicode escapes", () => {
    expect(
      parseStreamingArtifactToolInput(
        "write_file",
        '{"path":"artifacts/a.md","content":"\\u0041"}'
      )
    ).toEqual({
      content: "A",
      eligible: true,
      filename: "a.md",
      relativePath: "a.md",
    });
  });

  test("normalizes nested artifact paths", () => {
    expect(
      parseStreamingArtifactToolInput(
        "write_file",
        '{"path":"./artifacts/weekly/report.md","content":"ok"}'
      )
    ).toEqual({
      content: "ok",
      eligible: true,
      filename: "report.md",
      relativePath: "weekly/report.md",
    });
  });

  test("rejects meta sidecar paths", () => {
    expect(
      parseStreamingArtifactToolInput(
        "write_file",
        '{"path":"artifacts/report.md.nakama-meta.json","content":"{}"}'
      )
    ).toEqual({
      content: null,
      eligible: false,
      filename: null,
      relativePath: null,
    });
  });

  test("rejects partial meta sidecar paths while streaming", () => {
    expect(
      parseStreamingArtifactToolInput(
        "write_file",
        '{"path":"artifacts/report.md.nakama-meta","content":"{}"}'
      )
    ).toEqual({
      content: null,
      eligible: false,
      filename: null,
      relativePath: null,
    });

    expect(
      parseStreamingArtifactToolInput(
        "write_file",
        '{"path":"artifacts/tldr.md.nakama-m","content":"'
      )
    ).toEqual({
      content: null,
      eligible: false,
      filename: null,
      relativePath: null,
    });

    expect(
      parseStreamingArtifactToolInput(
        "write_file",
        '{"path":"artifacts/report.md.nak","content":"{}"}'
      )
    ).toEqual({
      content: null,
      eligible: false,
      filename: null,
      relativePath: null,
    });

    expect(
      parseStreamingArtifactToolInput(
        "write_file",
        '{"path":"artifacts/report.md.nakama","content":"{}"}'
      )
    ).toEqual({
      content: null,
      eligible: false,
      filename: null,
      relativePath: null,
    });
  });

  test("rejects incomplete paths so sidecar writes cannot look like content files", () => {
    // Sidecar path streams as `…md` before `.nakama-meta.json` is appended.
    expect(
      parseStreamingArtifactToolInput(
        "write_file",
        '{"path":"artifacts/tldr-llm-networking-mikrotik.md'
      )
    ).toEqual({
      content: null,
      eligible: false,
      filename: null,
      relativePath: null,
    });
  });

  test("rejects non-artifact paths", () => {
    expect(
      parseStreamingArtifactToolInput(
        "write_file",
        '{"path":"SOUL.md","content":"x"}'
      )
    ).toEqual({
      content: null,
      eligible: false,
      filename: null,
      relativePath: null,
    });
  });

  test("returns partial content for truncated JSON", () => {
    expect(
      parseStreamingArtifactToolInput(
        "write_file",
        '{"path":"artifacts/a.md","content":"line one\\nline tw'
      )
    ).toEqual({
      content: "line one\nline tw",
      eligible: true,
      filename: "a.md",
      relativePath: "a.md",
    });
  });
});
