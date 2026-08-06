import { describe, expect, test } from "bun:test";
import {
  artifactCodeLanguage,
  inferArtifactMimeType,
  isHtmlArtifactMimeType,
  isImageArtifactMimeType,
  isMarkdownArtifactMimeType,
  isTextArtifactMimeType,
  isUnknownArtifactMimeType,
  isVideoArtifactMimeType,
  looksLikeUtf8Text,
  resolveArtifactMimeType,
} from "./artifact-mime";

describe("inferArtifactMimeType", () => {
  test("maps common text extensions", () => {
    expect(inferArtifactMimeType("notes.md")).toBe("text/markdown");
    expect(inferArtifactMimeType("weekly/report.MARKDOWN")).toBe("text/markdown");
    expect(inferArtifactMimeType("slides.html")).toBe("text/html");
    expect(inferArtifactMimeType("data.json")).toBe("application/json");
  });

  test("maps common video extensions", () => {
    expect(inferArtifactMimeType("clip.mp4")).toBe("video/mp4");
    expect(inferArtifactMimeType("demo.M4V")).toBe("video/mp4");
    expect(inferArtifactMimeType("reel.webm")).toBe("video/webm");
    expect(inferArtifactMimeType("take.mov")).toBe("video/quicktime");
  });

  test("falls back to binary for unknown or extensionless names", () => {
    expect(inferArtifactMimeType("archive.bin")).toBe("application/octet-stream");
    expect(inferArtifactMimeType("Makefile")).toBe("application/octet-stream");
    expect(inferArtifactMimeType(".gitignore")).toBe("application/octet-stream");
  });
});

describe("resolveArtifactMimeType", () => {
  test("prefers a declared type", () => {
    expect(resolveArtifactMimeType("text/markdown; charset=utf-8", "report.md")).toBe(
      "text/markdown",
    );
  });

  test("falls back to the extension when the type is generic or missing", () => {
    expect(resolveArtifactMimeType("application/octet-stream", "report.md")).toBe("text/markdown");
    expect(resolveArtifactMimeType("application/octet-stream", "reel.mp4")).toBe("video/mp4");
    expect(resolveArtifactMimeType("", "page.html")).toBe("text/html");
  });
});

describe("mime predicates", () => {
  test("classifies markdown, html, text, image, and video", () => {
    expect(isMarkdownArtifactMimeType("text/markdown; charset=utf-8")).toBe(true);
    expect(isHtmlArtifactMimeType("text/html")).toBe(true);
    expect(isTextArtifactMimeType("text/markdown")).toBe(true);
    expect(isTextArtifactMimeType("application/octet-stream")).toBe(false);
    expect(isTextArtifactMimeType("image/png")).toBe(false);
    expect(isImageArtifactMimeType("image/png")).toBe(true);
    expect(isImageArtifactMimeType("image/jpeg")).toBe(true);
    expect(isImageArtifactMimeType("image/svg+xml")).toBe(false);
    expect(isImageArtifactMimeType("application/pdf")).toBe(false);
    expect(isVideoArtifactMimeType("video/mp4")).toBe(true);
    expect(isVideoArtifactMimeType("video/webm; codecs=vp9")).toBe(true);
    expect(isVideoArtifactMimeType("application/octet-stream")).toBe(false);
    expect(isVideoArtifactMimeType("image/png")).toBe(false);
    expect(isUnknownArtifactMimeType("application/octet-stream")).toBe(true);
    expect(isUnknownArtifactMimeType("text/plain")).toBe(false);
  });
});

describe("artifactCodeLanguage", () => {
  test("maps code and data files to a highlight language", () => {
    expect(artifactCodeLanguage("config.yaml")).toBe("yaml");
    expect(artifactCodeLanguage("query.sql")).toBe("sql");
    expect(artifactCodeLanguage("data.json")).toBe("json");
    expect(artifactCodeLanguage("app.tsx")).toBe("tsx");
  });

  test("leaves prose-ish text unhighlighted", () => {
    expect(artifactCodeLanguage("notes.txt")).toBeNull();
    expect(artifactCodeLanguage("report.md")).toBeNull();
    expect(artifactCodeLanguage("rows.csv")).toBeNull();
  });
});

describe("looksLikeUtf8Text", () => {
  const encode = (value: string) => new TextEncoder().encode(value);

  test("accepts utf-8 text, including multi-byte characters", () => {
    expect(looksLikeUtf8Text(encode("FROM node:22\nRUN bun install\n"))).toBe(true);
    expect(looksLikeUtf8Text(encode("halo — ada emoji 🎉 dan aksara 日本語"))).toBe(true);
    expect(looksLikeUtf8Text(new Uint8Array())).toBe(true);
  });

  test("rejects payloads with NUL bytes or invalid utf-8", () => {
    expect(looksLikeUtf8Text(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01]))).toBe(false);
    expect(looksLikeUtf8Text(new Uint8Array([0xff, 0xfe, 0xfd]))).toBe(false);
  });
});
