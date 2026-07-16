import { DOCX_MEDIA_TYPE, LEGACY_DOC_MEDIA_TYPE } from "../artifact-mime";
import { convertDocxToMarkdown } from "../docx-text";
import { MAX_DOCUMENT_BYTES } from "../message-content";
import { extractPdfText } from "../pdf-text";

const KB_ALLOWED_MEDIA_TYPES = new Set([
  "application/pdf",
  DOCX_MEDIA_TYPE,
  LEGACY_DOC_MEDIA_TYPE,
  "text/plain",
  "text/csv",
  "text/markdown",
]);

const KB_EXTENSION_MEDIA_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": DOCX_MEDIA_TYPE,
  ".doc": LEGACY_DOC_MEDIA_TYPE,
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
};

export function normalizeKnowledgeBaseMediaType(mediaType: string, filename: string): string {
  const trimmed = mediaType.trim().toLowerCase();
  const extension = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  const fromExtension = KB_EXTENSION_MEDIA_TYPES[extension];

  if (fromExtension) {
    return fromExtension;
  }

  if (KB_ALLOWED_MEDIA_TYPES.has(trimmed)) {
    return trimmed;
  }

  return trimmed;
}

export function isSupportedKnowledgeBaseMediaType(mediaType: string, filename: string): boolean {
  const normalized = normalizeKnowledgeBaseMediaType(mediaType, filename);
  return KB_ALLOWED_MEDIA_TYPES.has(normalized);
}

export async function extractText(
  mediaType: string,
  filename: string,
  bytes: Buffer,
): Promise<string> {
  if (bytes.length > MAX_DOCUMENT_BYTES) {
    throw new Error(`Document must be at most ${MAX_DOCUMENT_BYTES / (1024 * 1024)} MB.`);
  }

  const normalized = normalizeKnowledgeBaseMediaType(mediaType, filename);

  if (!KB_ALLOWED_MEDIA_TYPES.has(normalized)) {
    throw new Error(
      `Unsupported knowledge base document type: ${mediaType}. Allowed: txt, md, csv, pdf, docx.`,
    );
  }

  if (normalized === "application/pdf") {
    return extractPdfText(bytes);
  }

  // Word-named uploads are decided by their bytes: a real .docx, a legacy OLE .doc
  // (rejected with an actionable message), or HTML saved under a Word extension.
  if (normalized === DOCX_MEDIA_TYPE || normalized === LEGACY_DOC_MEDIA_TYPE) {
    return convertDocxToMarkdown(bytes);
  }

  return bytes.toString("utf8").trim();
}

export function buildExtractedTextHeader(options: {
  filename: string;
  mediaType: string;
  uploadedAt: string;
}): string {
  return [
    `# source: ${options.filename}`,
    `# mediaType: ${options.mediaType}`,
    `# uploadedAt: ${options.uploadedAt}`,
    "",
  ].join("\n");
}
