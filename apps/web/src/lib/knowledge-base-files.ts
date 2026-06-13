import type { DocumentAttachment } from "@tinyclaw/core/contract";
import { normalizeDocumentMediaType, parseDocumentDataUrl } from "@tinyclaw/core/message-content";

export const KNOWLEDGE_BASE_ACCEPT =
  ".pdf,.txt,.md,.csv,application/pdf,text/plain,text/csv,text/markdown";

const KB_EXTENSIONS = new Set([".pdf", ".txt", ".md", ".csv"]);

export function isKnowledgeBaseFile(file: File): boolean {
  const filename = file.name.trim();
  const extension = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  const mediaType = normalizeDocumentMediaType(file.type, filename);

  return (
    KB_EXTENSIONS.has(extension) ||
    mediaType === "application/pdf" ||
    mediaType === "text/plain" ||
    mediaType === "text/csv" ||
    mediaType === "text/markdown"
  );
}

export function fileToDocumentAttachment(file: File): Promise<DocumentAttachment | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === "string" ? reader.result : null;
      if (!result) {
        resolve(null);
        return;
      }

      const filename = file.name.trim() || "document";
      resolve(parseDocumentDataUrl(result, filename));
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
