import {
  isDocxFile,
  isHtmlArtifactMimeType,
  isLegacyDocFile,
  isMarkdownArtifactMimeType,
} from "@/lib/chat-artifacts";

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

  if (mimeType === "application/json") {
    return "Download as JSON";
  }

  return "Download";
}
