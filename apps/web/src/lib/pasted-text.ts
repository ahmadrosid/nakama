import type { MessageContentPart } from "@nakama/core/contract";
import type { FileUIPart } from "@/lib/ai-ui-types";

export const LONG_PASTE_WORD_THRESHOLD = 300;

const PASTED_TEXT_FILENAME_RE = /^Pasted text \((\d+) words\)\.txt$/;

export function normalizePastedText(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

export function countWords(text: string): number {
  const normalized = normalizePastedText(text).trim();

  if (!normalized) {
    return 0;
  }

  return normalized.split(/\s+/).filter(Boolean).length;
}

function pastedTextFilename(wordCount: number): string {
  return `Pasted text (${wordCount} words).txt`;
}

export function createPastedTextFile(text: string): File {
  const normalized = normalizePastedText(text);
  const wordCount = countWords(normalized);

  return new File([normalized], pastedTextFilename(wordCount), {
    type: "text/plain",
  });
}

export function isPastedTextDocument(
  filename: string,
  mediaType: string
): boolean {
  return (
    mediaType.startsWith("text/plain") && PASTED_TEXT_FILENAME_RE.test(filename)
  );
}

export function wordCountFromPastedFilename(filename: string): number | null {
  const match = filename.match(PASTED_TEXT_FILENAME_RE);

  if (!match) {
    return null;
  }

  return Number.parseInt(match[1]!, 10);
}

export interface DisplayDocument {
  /** Where the panel fetches the bytes from: the attachment route for
   * persisted parts, a data URL for inline parts and just-sent files. */
  contentUrl?: string;
  filename: string;
  mediaType: string;
}

export function documentDisplayFromContentPart(
  part: Extract<MessageContentPart, { type: "document" | "document_ref" }>
): DisplayDocument {
  if (part.type === "document_ref") {
    return {
      contentUrl: `/v1/attachments/${encodeURIComponent(part.attachmentId)}/content`,
      filename: part.filename,
      mediaType: part.mediaType,
    };
  }

  return {
    contentUrl: `data:${part.mediaType};base64,${part.data}`,
    filename: part.filename,
    mediaType: part.mediaType,
  };
}

export function documentDisplayFromFilePart(file: FileUIPart): DisplayDocument {
  return {
    contentUrl: file.url || undefined,
    filename: file.filename?.trim() || "document",
    mediaType: file.mediaType ?? "",
  };
}
