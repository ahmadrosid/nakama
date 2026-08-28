import { describe, expect, test } from "bun:test";
import {
  artifactCanTogglePreviewSource,
  artifactPanelBodyClassName,
  artifactPanelHeaderMeta,
  artifactPanelHeadingName,
  artifactPanelTypeLabel,
} from "./artifact-attachment-panel-body.shared";

describe("artifact preview source toggle", () => {
  test("allows html, markdown, and spreadsheet", () => {
    expect(
      artifactCanTogglePreviewSource({ isHtml: true, isMarkdown: false })
    ).toBe(true);
    expect(
      artifactCanTogglePreviewSource({ isHtml: false, isMarkdown: true })
    ).toBe(true);
    expect(
      artifactCanTogglePreviewSource({
        isHtml: false,
        isMarkdown: false,
        isSpreadsheet: true,
      })
    ).toBe(true);
    expect(
      artifactCanTogglePreviewSource({ isHtml: false, isMarkdown: false })
    ).toBe(false);
  });
});

describe("artifact panel header", () => {
  test("strips the extension from the heading name", () => {
    expect(artifactPanelHeadingName("Gpt2 slides.html")).toBe("Gpt2 slides");
    expect(artifactPanelHeadingName("notes.md")).toBe("notes");
    expect(artifactPanelHeadingName("README")).toBe("README");
  });

  test("labels html, markdown, and csv files", () => {
    expect(
      artifactPanelTypeLabel({
        filename: "deck.html",
        mimeType: "text/html",
      })
    ).toBe("HTML");
    expect(
      artifactPanelTypeLabel({
        filename: "notes.md",
        mimeType: "text/markdown",
      })
    ).toBe("Markdown");
    expect(
      artifactPanelTypeLabel({
        filename: "sample_customers.csv",
        mimeType: "text/csv",
      })
    ).toBe("CSV");
  });

  test("replaces mime size subtitle with type when toggle is shown", () => {
    expect(
      artifactPanelHeaderMeta({
        filename: "notes.md",
        mimeType: "text/markdown",
        showPreviewToggle: true,
        sizeBytes: 7700,
      })
    ).toEqual({
      subtitle: null,
      title: "notes",
      typeLabel: "Markdown",
    });
  });
});

describe("artifact panel body class", () => {
  test("source view fills the panel with no padding", () => {
    expect(
      artifactPanelBodyClassName({
        isHtml: true,
        isImage: false,
        isMarkdown: false,
        previewMode: "source",
      })
    ).toBe("flex flex-col overflow-hidden p-0");
    expect(
      artifactPanelBodyClassName({
        isHtml: false,
        isImage: false,
        isMarkdown: true,
        previewMode: "source",
      })
    ).toBe("flex flex-col overflow-hidden p-0");
    expect(
      artifactPanelBodyClassName({
        isHtml: false,
        isImage: false,
        isMarkdown: false,
        isSpreadsheet: true,
        previewMode: "preview",
      })
    ).toBe("flex flex-col overflow-hidden p-0");
  });

  test("markdown preview uses the full panel width", () => {
    expect(
      artifactPanelBodyClassName({
        isHtml: false,
        isImage: false,
        isMarkdown: true,
        previewMode: "preview",
      })
    ).toBe("artifact-preview-panel");
  });
});
