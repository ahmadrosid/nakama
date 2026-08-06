import {
  artifactCodeLanguage,
  isDocxFile,
  isHtmlArtifactMimeType,
  isImageArtifactMimeType,
  isLegacyDocFile,
  isMarkdownArtifactMimeType,
} from "@/lib/chat-artifacts";
import { formatBytes } from "@/lib/knowledge-base-files";

const WIDE_ARTIFACT_PANEL_WIDTH = 768;
const NARROW_ARTIFACT_PANEL_WIDTH = 448;

export function artifactPanelDefaultWidth(
  filename: string,
  mimeType: string,
): number {
  const isHtml = isHtmlArtifactMimeType(mimeType);
  const isImage = isImageArtifactMimeType(mimeType);
  const isWordDocument =
    isDocxFile(filename, mimeType) || isLegacyDocFile(filename, mimeType);
  const isMarkdown = isMarkdownArtifactMimeType(mimeType) || isWordDocument;
  const language = artifactCodeLanguage(filename);

  return isHtml || isImage || isMarkdown || language
    ? WIDE_ARTIFACT_PANEL_WIDTH
    : NARROW_ARTIFACT_PANEL_WIDTH;
}

export function artifactPanelBodyClassName({
  isHtml,
  isImage,
  isMarkdown,
}: {
  isHtml: boolean;
  isImage: boolean;
  isMarkdown: boolean;
}): string | undefined {
  if (isHtml || isImage) {
    return "flex flex-col overflow-hidden p-0";
  }

  if (!isMarkdown) {
    return "flex flex-col overflow-hidden";
  }

  return undefined;
}

export function artifactPanelSubtitle({
  mimeType,
  sizeBytes = 0,
  streaming = false,
}: {
  mimeType: string;
  sizeBytes?: number;
  streaming?: boolean;
}): string {
  const parts = [mimeType];

  if (streaming) {
    parts.push("Writing…");
  } else if (sizeBytes > 0) {
    parts.push(formatBytes(sizeBytes));
  }

  return parts.join(" · ");
}

export function downloadActionLabel(mimeType: string): string {
  if (isHtmlArtifactMimeType(mimeType)) {
    return "Download as HTML";
  }

  if (isDocxFile("", mimeType) || isLegacyDocFile("", mimeType)) {
    return "Download as Word";
  }

  if (isMarkdownArtifactMimeType(mimeType)) {
    return "Download as Markdown";
  }

  if (isImageArtifactMimeType(mimeType)) {
    return "Download image";
  }

  if (mimeType === "application/json") {
    return "Download as JSON";
  }

  return "Download";
}
