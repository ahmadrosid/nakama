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
  bash: "text/plain",
  cjs: "application/javascript",
  conf: "text/plain",
  css: "text/css",
  csv: "text/csv",
  doc: LEGACY_DOC_MEDIA_TYPE,
  docx: DOCX_MEDIA_TYPE,
  env: "text/plain",
  gif: "image/gif",
  go: "text/plain",
  htm: "text/html",
  html: "text/html",
  ini: "text/plain",
  java: "text/plain",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  js: "application/javascript",
  json: "application/json",
  jsonl: "application/json",
  jsx: "text/plain",
  log: "text/plain",
  m4v: "video/mp4",
  markdown: "text/markdown",
  md: "text/markdown",
  mdx: "text/markdown",
  mjs: "application/javascript",
  mov: "video/quicktime",
  mp4: "video/mp4",
  ogv: "video/ogg",
  pdf: "application/pdf",
  php: "text/plain",
  png: "image/png",
  py: "text/plain",
  rb: "text/plain",
  rs: "text/plain",
  sh: "text/plain",
  sql: "text/plain",
  svg: "image/svg+xml",
  toml: "text/plain",
  ts: "text/plain",
  tsv: "text/tab-separated-values",
  tsx: "text/plain",
  txt: "text/plain",
  webm: "video/webm",
  webp: "image/webp",
  xhtml: "application/xhtml+xml",
  xml: "application/xml",
  yaml: "text/plain",
  yml: "text/plain",
  zsh: "text/plain",
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
export function resolveArtifactMimeType(
  declaredMimeType: string,
  filename: string
): string {
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

/** Videos previewable with `<video controls>` in the attachment panel. */
export function isVideoArtifactMimeType(mimeType: string): boolean {
  return normalizeMimeType(mimeType).startsWith("video/");
}

/** True when the type carries no information about how to render the bytes. */
export function isUnknownArtifactMimeType(mimeType: string): boolean {
  return normalizeMimeType(mimeType) === UNKNOWN_MIME_TYPE;
}

/** A `.docx` is a ZIP of OOXML parts: never UTF-8, but convertible to Markdown. */
export function isDocxFile(filename: string, mediaType = ""): boolean {
  return (
    fileExtension(filename) === "docx" ||
    normalizeMimeType(mediaType) === DOCX_MEDIA_TYPE
  );
}

export function isLegacyDocFile(filename: string, mediaType = ""): boolean {
  return (
    fileExtension(filename) === "doc" ||
    normalizeMimeType(mediaType) === LEGACY_DOC_MEDIA_TYPE
  );
}

const CODE_LANGUAGE_BY_EXTENSION: Record<string, string> = {
  bash: "bash",
  cjs: "javascript",
  conf: "ini",
  css: "css",
  env: "ini",
  go: "go",
  ini: "ini",
  java: "java",
  js: "javascript",
  json: "json",
  jsonl: "json",
  jsx: "jsx",
  mjs: "javascript",
  php: "php",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "bash",
  sql: "sql",
  svg: "xml",
  toml: "toml",
  ts: "typescript",
  tsx: "tsx",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "bash",
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
