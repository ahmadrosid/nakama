import type { ArtifactFile } from "@nakama/core/contract";
import {
  isDocxFile,
  isHtmlArtifactMimeType,
  isImageArtifactMimeType,
  isLegacyDocFile,
  isMarkdownArtifactMimeType,
  isTextArtifactMimeType,
  isVideoArtifactMimeType,
  resolveArtifactMimeType,
} from "@/lib/chat-artifacts";

export const ARTIFACT_TYPE_FILTERS = [
  "all",
  "markdown",
  "html",
  "image",
  "video",
  "document",
  "text",
  "other",
] as const;

export type ArtifactTypeFilter = (typeof ARTIFACT_TYPE_FILTERS)[number];

export const ARTIFACT_TYPE_FILTER_LABELS: Record<ArtifactTypeFilter, string> = {
  all: "All types",
  document: "Documents",
  html: "HTML",
  image: "Images",
  markdown: "Markdown",
  other: "Other",
  text: "Text",
  video: "Video",
};

export function classifyArtifactType(
  artifact: ArtifactFile
): Exclude<ArtifactTypeFilter, "all"> {
  const mimeType = resolveArtifactMimeType(
    artifact.mimeType,
    artifact.filename
  );

  if (isMarkdownArtifactMimeType(mimeType)) {
    return "markdown";
  }

  if (isHtmlArtifactMimeType(mimeType)) {
    return "html";
  }

  if (isImageArtifactMimeType(mimeType)) {
    return "image";
  }

  if (isVideoArtifactMimeType(mimeType)) {
    return "video";
  }

  if (
    isDocxFile(artifact.filename, mimeType) ||
    isLegacyDocFile(artifact.filename, mimeType) ||
    mimeType === "application/pdf"
  ) {
    return "document";
  }

  if (isTextArtifactMimeType(mimeType)) {
    return "text";
  }

  return "other";
}

export function artifactMatchesTypeFilter(
  artifact: ArtifactFile,
  filter: ArtifactTypeFilter
): boolean {
  return filter === "all" || classifyArtifactType(artifact) === filter;
}

/** Type options present in the list (plus `all`), ordered for the filter menu. */
export function availableArtifactTypeFilters(
  artifacts: ArtifactFile[]
): ArtifactTypeFilter[] {
  const present = new Set(artifacts.map(classifyArtifactType));
  return ARTIFACT_TYPE_FILTERS.filter(
    (filter) => filter === "all" || present.has(filter)
  );
}
