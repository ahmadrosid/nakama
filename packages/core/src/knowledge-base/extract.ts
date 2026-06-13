import { PDFParse } from "pdf-parse";
import { MAX_DOCUMENT_BYTES } from "../message-content";

const KB_ALLOWED_MEDIA_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/csv",
  "text/markdown",
]);

const KB_EXTENSION_MEDIA_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
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
      `Unsupported knowledge base document type: ${mediaType}. Allowed: txt, md, csv, pdf.`,
    );
  }

  if (normalized === "application/pdf") {
    return extractPdfText(bytes);
  }

  return bytes.toString("utf8").trim();
}

async function extractPdfText(bytes: Buffer): Promise<string> {
  const parser = new PDFParse({ data: bytes });

  try {
    const result = await parser.getText();
    return result.text.trim();
  } finally {
    await parser.destroy();
  }
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
