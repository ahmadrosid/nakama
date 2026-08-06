import { clampAttachmentPanelWidth } from "@/components/chat/attachment-panel-width";
import {
  artifactCodeLanguage,
  isDocxFile,
  isHtmlArtifactMimeType,
  isImageArtifactMimeType,
  isLegacyDocFile,
  isMarkdownArtifactMimeType,
  isVideoArtifactMimeType,
} from "@/lib/chat-artifacts";
import { formatBytes } from "@/lib/knowledge-base-files";

const WIDE_ARTIFACT_PANEL_WIDTH = 768;
const NARROW_ARTIFACT_PANEL_WIDTH = 448;
/** Videos (often portrait reels) leave chat usable on tablet; avoid the 768 wide default. */
const VIDEO_ARTIFACT_PANEL_WIDTH = 420;

export function artifactPanelDefaultWidth(
  filename: string,
  mimeType: string,
): number {
  const isHtml = isHtmlArtifactMimeType(mimeType);
  const isImage = isImageArtifactMimeType(mimeType);
  const isVideo = isVideoArtifactMimeType(mimeType);
  const isWordDocument =
    isDocxFile(filename, mimeType) || isLegacyDocFile(filename, mimeType);
  const isMarkdown = isMarkdownArtifactMimeType(mimeType) || isWordDocument;
  const language = artifactCodeLanguage(filename);

  const baseWidth = isVideo
    ? VIDEO_ARTIFACT_PANEL_WIDTH
    : isHtml || isImage || isMarkdown || language
      ? WIDE_ARTIFACT_PANEL_WIDTH
      : NARROW_ARTIFACT_PANEL_WIDTH;

  return clampAttachmentPanelWidth(baseWidth);
}

export function artifactPanelBodyClassName({
  isHtml,
  isImage,
  isVideo = false,
  isMarkdown,
}: {
  isHtml: boolean;
  isImage: boolean;
  isVideo?: boolean;
  isMarkdown: boolean;
}): string | undefined {
  if (isHtml || isImage || isVideo) {
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

  if (isVideoArtifactMimeType(mimeType)) {
    return "Download video";
  }

  if (mimeType === "application/json") {
    return "Download as JSON";
  }

  return "Download";
}
