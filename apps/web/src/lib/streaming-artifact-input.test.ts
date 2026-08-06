import { describe, expect, test } from "bun:test";
import { parseStreamingArtifactToolInput } from "./streaming-artifact-input";

describe("parseStreamingArtifactToolInput", () => {
  test("returns eligible write_file artifact with path and content", () => {
    expect(
      parseStreamingArtifactToolInput(
        "write_file",
        '{"path":"artifacts/report.md","content":"# Report\\n"}',
      ),
    ).toEqual({
      eligible: true,
      relativePath: "report.md",
      filename: "report.md",
      content: "# Report\n",
    });
  });

  test("returns markdown content for write_docx", () => {
    expect(
      parseStreamingArtifactToolInput(
        "write_docx",
        '{"path":"artifacts/report.docx","markdown":"# Title"}',
      ),
    ).toEqual({
      eligible: true,
      relativePath: "report.docx",
      filename: "report.docx",
      content: "# Title",
    });
  });

  test("returns content before path is known", () => {
    expect(parseStreamingArtifactToolInput("write_file", '{"content":"# Partial"')).toEqual({
      eligible: false,
      relativePath: null,
      filename: null,
      content: "# Partial",
    });
  });

  test("decodes split unicode escapes", () => {
    expect(
      parseStreamingArtifactToolInput(
        "write_file",
        '{"path":"artifacts/a.md","content":"\\u0041"}',
      ),
    ).toEqual({
      eligible: true,
      relativePath: "a.md",
      filename: "a.md",
      content: "A",
    });
  });

  test("normalizes nested artifact paths", () => {
    expect(
      parseStreamingArtifactToolInput(
        "write_file",
        '{"path":"./artifacts/weekly/report.md","content":"ok"}',
      ),
    ).toEqual({
      eligible: true,
      relativePath: "weekly/report.md",
      filename: "report.md",
      content: "ok",
    });
  });

  test("rejects meta sidecar paths", () => {
    expect(
      parseStreamingArtifactToolInput(
        "write_file",
        '{"path":"artifacts/report.md.nakama-meta.json","content":"{}"}',
      ),
    ).toEqual({
      eligible: false,
      relativePath: null,
      filename: null,
      content: null,
    });
  });

  test("rejects partial meta sidecar paths while streaming", () => {
    expect(
      parseStreamingArtifactToolInput(
        "write_file",
        '{"path":"artifacts/report.md.nakama-meta","content":"{}"}',
      ),
    ).toEqual({
      eligible: false,
      relativePath: null,
      filename: null,
      content: null,
    });

    expect(
      parseStreamingArtifactToolInput(
        "write_file",
        '{"path":"artifacts/tldr.md.nakama-m","content":"',
      ),
    ).toEqual({
      eligible: false,
      relativePath: null,
      filename: null,
      content: null,
    });

    expect(
      parseStreamingArtifactToolInput(
        "write_file",
        '{"path":"artifacts/report.md.nak","content":"{}"}',
      ),
    ).toEqual({
      eligible: false,
      relativePath: null,
      filename: null,
      content: null,
    });

    expect(
      parseStreamingArtifactToolInput(
        "write_file",
        '{"path":"artifacts/report.md.nakama","content":"{}"}',
      ),
    ).toEqual({
      eligible: false,
      relativePath: null,
      filename: null,
      content: null,
    });
  });

  test("rejects incomplete paths so sidecar writes cannot look like content files", () => {
    // Sidecar path streams as `…md` before `.nakama-meta.json` is appended.
    expect(
      parseStreamingArtifactToolInput(
        "write_file",
        '{"path":"artifacts/tldr-llm-networking-mikrotik.md',
      ),
    ).toEqual({
      eligible: false,
      relativePath: null,
      filename: null,
      content: null,
    });
  });

  test("rejects non-artifact paths", () => {
    expect(
      parseStreamingArtifactToolInput("write_file", '{"path":"SOUL.md","content":"x"}'),
    ).toEqual({
      eligible: false,
      relativePath: null,
      filename: null,
      content: null,
    });
  });

  test("returns partial content for truncated JSON", () => {
    expect(
      parseStreamingArtifactToolInput(
        "write_file",
        '{"path":"artifacts/a.md","content":"line one\\nline tw',
      ),
    ).toEqual({
      eligible: true,
      relativePath: "a.md",
      filename: "a.md",
      content: "line one\nline tw",
    });
  });
});
