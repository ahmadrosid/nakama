import type { ArtifactPreviewMode } from "@/components/chat/artifact-preview-mode-toggle";
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
  mimeType: string
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

export function artifactCanTogglePreviewSource({
  isHtml,
  isMarkdown,
}: {
  isHtml: boolean;
  isMarkdown: boolean;
}): boolean {
  return isHtml || isMarkdown;
}

export function artifactPanelHeadingName(filename: string): string {
  const slash = filename.lastIndexOf("/");
  const base = slash >= 0 ? filename.slice(slash + 1) : filename;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) {
    return base;
  }
  return base.slice(0, dot);
}

export function artifactPanelTypeLabel({
  filename,
  mimeType,
}: {
  filename: string;
  mimeType: string;
}): string {
  if (isHtmlArtifactMimeType(mimeType)) {
    return "HTML";
  }

  if (
    isMarkdownArtifactMimeType(mimeType) ||
    isDocxFile(filename, mimeType) ||
    isLegacyDocFile(filename, mimeType)
  ) {
    return "Markdown";
  }

  const language = artifactCodeLanguage(filename);
  if (language) {
    return language.toUpperCase();
  }

  const subtype = mimeType.split("/")[1]?.trim();
  return subtype ? subtype.toUpperCase() : "FILE";
}

export function artifactPanelHeaderMeta({
  filename,
  mimeType,
  sizeBytes = 0,
  streaming = false,
  showPreviewToggle,
}: {
  filename: string;
  mimeType: string;
  sizeBytes?: number;
  streaming?: boolean;
  showPreviewToggle: boolean;
}): {
  subtitle: string | null;
  title: string;
  typeLabel: string | null;
} {
  if (showPreviewToggle) {
    return {
      subtitle: null,
      title: artifactPanelHeadingName(filename),
      typeLabel: artifactPanelTypeLabel({ filename, mimeType }),
    };
  }

  return {
    subtitle: artifactPanelSubtitle({ mimeType, sizeBytes, streaming }),
    title: filename,
    typeLabel: null,
  };
}

export function artifactPanelBodyClassName({
  isHtml,
  isImage,
  isVideo = false,
  isMarkdown,
  previewMode = "preview",
}: {
  isHtml: boolean;
  isImage: boolean;
  isVideo?: boolean;
  isMarkdown: boolean;
  previewMode?: ArtifactPreviewMode;
}): string | undefined {
  if (isHtml && previewMode === "source") {
    return "flex flex-col overflow-hidden";
  }

  if (isHtml || isImage || isVideo) {
    return "flex flex-col overflow-hidden p-0";
  }

  if (!isMarkdown || previewMode === "source") {
    return "flex flex-col overflow-hidden";
  }
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
