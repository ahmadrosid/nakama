import { describe, expect, test } from "bun:test";
import {
  ARTIFACT_HTML_IFRAME_SANDBOX,
  htmlForArtifactPreview,
} from "./artifact-html-preview";

describe("artifact HTML preview", () => {
  test("sandbox allows scripts without same-origin access to host", () => {
    expect(ARTIFACT_HTML_IFRAME_SANDBOX).toContain("allow-scripts");
    expect(ARTIFACT_HTML_IFRAME_SANDBOX).not.toContain("allow-same-origin");
  });
});

describe("htmlForArtifactPreview", () => {
  test("injects scrollbar styles into head", () => {
    const html = "<html><head><title>Slides</title></head><body></body></html>";
    expect(htmlForArtifactPreview(html)).toContain("<head><style data-nakama-html-preview>");
  });

  test("wraps fragments with style tag", () => {
    expect(htmlForArtifactPreview("<div>slide</div>")).toStartWith(
      "<style data-nakama-html-preview>",
    );
  });
});
