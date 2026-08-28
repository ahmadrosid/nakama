import { describe, expect, test } from "bun:test";
import { htmlForArtifactPreview } from "./artifact-html-preview";

describe("htmlForArtifactPreview", () => {
  test("injects scrollbar styles into head", () => {
    const html = "<html><head><title>Slides</title></head><body></body></html>";
    expect(htmlForArtifactPreview(html)).toContain(
      "<head><style data-nakama-html-preview>"
    );
  });

  test("wraps fragments with style tag", () => {
    expect(htmlForArtifactPreview("<div>slide</div>")).toStartWith(
      "<style data-nakama-html-preview>"
    );
  });
});
