/**
 * Single source of truth for artifact MIME types, shared by the server (which
 * serves artifact bytes) and the web app (which decides how to preview them).
 */

const UNKNOWN_MIME_TYPE = "application/octet-stream";

export const DOCX_MEDIA_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const LEGACY_DOC_MEDIA_TYPE = "application/msword";

/**
 * The legacy OLE-based `.doc` format has no dependable parser in the JS ecosystem,
 * so we refuse it loudly rather than emit mojibake.
 */
export const LEGACY_DOC_UNSUPPORTED_MESSAGE =
  "Legacy .doc files (Word 97-2003) are not supported. Convert the file to .docx and try again.";

const MIME_TYPE_BY_EXTENSION: Record<string, string> = {
  docx: DOCX_MEDIA_TYPE,
  doc: LEGACY_DOC_MEDIA_TYPE,
  md: "text/markdown",
  markdown: "text/markdown",
  mdx: "text/markdown",
  html: "text/html",
  htm: "text/html",
  xhtml: "application/xhtml+xml",
  json: "application/json",
  jsonl: "application/json",
  js: "application/javascript",
  mjs: "application/javascript",
  cjs: "application/javascript",
  ts: "text/plain",
  tsx: "text/plain",
  jsx: "text/plain",
  py: "text/plain",
  rb: "text/plain",
  go: "text/plain",
  rs: "text/plain",
  java: "text/plain",
  php: "text/plain",
  sql: "text/plain",
  sh: "text/plain",
  bash: "text/plain",
  zsh: "text/plain",
  env: "text/plain",
  ini: "text/plain",
  conf: "text/plain",
  yaml: "text/plain",
  yml: "text/plain",
  toml: "text/plain",
  css: "text/css",
  xml: "application/xml",
  svg: "image/svg+xml",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  txt: "text/plain",
  log: "text/plain",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

function fileExtension(filename: string): string {
  const basename = filename.split(/[\\/]/).pop() ?? filename;
  const dotIndex = basename.lastIndexOf(".");

  if (dotIndex <= 0 || dotIndex === basename.length - 1) {
    return "";
  }

  return basename.slice(dotIndex + 1).toLowerCase();
}

/** Best-effort MIME type for an artifact that has no `.nakama-meta.json` sidecar. */
export function inferArtifactMimeType(filename: string): string {
  return MIME_TYPE_BY_EXTENSION[fileExtension(filename)] ?? UNKNOWN_MIME_TYPE;
}

/** Strip parameters (`text/markdown; charset=utf-8`) and normalize casing. */
export function normalizeMimeType(mimeType: string): string {
  return mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
}

/**
 * Resolve the type to preview by: a declared type wins, unless it is missing or
 * the generic binary fallback — then trust the filename extension.
 */
export function resolveArtifactMimeType(declaredMimeType: string, filename: string): string {
  const declared = normalizeMimeType(declaredMimeType);

  if (!declared || declared === UNKNOWN_MIME_TYPE) {
    return inferArtifactMimeType(filename);
  }

  return declared;
}

export function isHtmlArtifactMimeType(mimeType: string): boolean {
  const normalized = normalizeMimeType(mimeType);
  return normalized === "text/html" || normalized === "application/xhtml+xml";
}

export function isMarkdownArtifactMimeType(mimeType: string): boolean {
  return normalizeMimeType(mimeType) === "text/markdown";
}

export function isTextArtifactMimeType(mimeType: string): boolean {
  const normalized = normalizeMimeType(mimeType);

  return (
    normalized.startsWith("text/") ||
    normalized === "application/json" ||
    normalized === "application/javascript" ||
    normalized === "application/xml" ||
    normalized === "image/svg+xml"
  );
}

/** Raster images previewable with `<img>`; SVG stays in the text path. */
export function isImageArtifactMimeType(mimeType: string): boolean {
  const normalized = normalizeMimeType(mimeType);

  if (!normalized.startsWith("image/") || normalized === "image/svg+xml") {
    return false;
  }

  return true;
}

/** True when the type carries no information about how to render the bytes. */
export function isUnknownArtifactMimeType(mimeType: string): boolean {
  return normalizeMimeType(mimeType) === UNKNOWN_MIME_TYPE;
}

/** A `.docx` is a ZIP of OOXML parts: never UTF-8, but convertible to Markdown. */
export function isDocxFile(filename: string, mediaType = ""): boolean {
  return fileExtension(filename) === "docx" || normalizeMimeType(mediaType) === DOCX_MEDIA_TYPE;
}

export function isLegacyDocFile(filename: string, mediaType = ""): boolean {
  return (
    fileExtension(filename) === "doc" || normalizeMimeType(mediaType) === LEGACY_DOC_MEDIA_TYPE
  );
}

const CODE_LANGUAGE_BY_EXTENSION: Record<string, string> = {
  json: "json",
  jsonl: "json",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  ts: "typescript",
  tsx: "tsx",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  php: "php",
  sql: "sql",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  ini: "ini",
  conf: "ini",
  env: "ini",
  css: "css",
  xml: "xml",
  svg: "xml",
};

/**
 * Syntax-highlighting language for an artifact, or `null` for prose-ish text
 * (`.txt`, `.log`, `.csv`) that reads better unhighlighted.
 */
export function artifactCodeLanguage(filename: string): string | null {
  return CODE_LANGUAGE_BY_EXTENSION[fileExtension(filename)] ?? null;
}

/**
 * Sniff whether bytes are UTF-8 text, so files with an unrecognized extension
 * (`Dockerfile`, `notes.abc`) can still be previewed instead of being written off
 * as binary. NUL bytes and invalid UTF-8 sequences mark a payload as binary.
 */
export function looksLikeUtf8Text(bytes: Uint8Array): boolean {
  if (bytes.subarray(0, 8192).includes(0)) {
    return false;
  }

  try {
    // Decoding the whole payload (not a sample) avoids a false negative from a
    // multi-byte character straddling the sample boundary; `fatal` throws on the
    // first invalid sequence, so binary input bails out early.
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/** MIME types that must not be served inline on the app origin (public shares). */
export function isBrowserExecutableArtifactMimeType(mimeType: string): boolean {
  const normalized = mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
  return (
    normalized === "text/html" ||
    normalized === "application/xhtml+xml" ||
    normalized.startsWith("image/svg")
  );
}
