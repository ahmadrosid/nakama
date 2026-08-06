/** Shared with email body truncation (`MAX_EMAIL_BODY_BYTES`) — keep in sync. */
export const ANYDOC_MAX_OUTPUT_BYTES = 256 * 1024;
export const ANYDOC_TIMEOUT_MS = 10_000;
export const ANYDOC_MAX_CONCURRENT = 2;

function truncateUtf8(
  value: string,
  maxBytes = ANYDOC_MAX_OUTPUT_BYTES,
): { text: string; truncated: boolean } {
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes <= maxBytes) {
    return { text: value, truncated: false };
  }

  let end = value.length;
  while (end > 0 && Buffer.byteLength(value.slice(0, end), "utf8") > maxBytes) {
    end -= 1;
  }

  return {
    text: `${value.slice(0, end)}…`,
    truncated: true,
  };
}

export type AnydocFormat =
  | "doc"
  | "docx"
  | "odt"
  | "pdf"
  | "ppt"
  | "pptx"
  | "rtf"
  | "epub"
  | "xlsx"
  | "ods"
  | "odp"
  | "csv";

export interface AnydocConvertResult {
  text: string;
  truncated: boolean;
}

export interface ConvertDocumentBytesOptions {
  format?: AnydocFormat | null;
  mediaType?: string;
  filename?: string;
  maxOutputBytes?: number;
  timeoutMs?: number;
  /** Test seam — defaults to `@firecrawl/anydoc` `toMarkdownBytes`. */
  convertFn?: (
    bytes: Uint8Array,
    format: AnydocFormat | null,
  ) => Promise<string>;
}

const MEDIA_TYPE_TO_FORMAT: Record<string, AnydocFormat> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xlsx",
  "application/vnd.ms-excel.sheet.macroEnabled.12": "xlsx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml": "xlsx",
  "application/vnd.ms-excel.sheet.binary.macroEnabled.12": "xlsx",
  "text/csv": "csv",
  "application/csv": "csv",
};

let activeConversions = 0;
const waitQueue: Array<() => void> = [];

async function withAnydocSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeConversions >= ANYDOC_MAX_CONCURRENT) {
    await new Promise<void>((resolve) => {
      waitQueue.push(resolve);
    });
  }

  activeConversions += 1;
  try {
    return await fn();
  } finally {
    activeConversions -= 1;
    const next = waitQueue.shift();
    if (next) {
      next();
    }
  }
}

export function resolveAnydocFormat(
  mediaType?: string,
  filename?: string,
): AnydocFormat | null {
  const normalizedMedia = mediaType?.trim().toLowerCase() ?? "";
  if (normalizedMedia && MEDIA_TYPE_TO_FORMAT[normalizedMedia]) {
    return MEDIA_TYPE_TO_FORMAT[normalizedMedia];
  }

  const extension = filename?.includes(".")
    ? filename.slice(filename.lastIndexOf(".")).toLowerCase()
    : "";

  switch (extension) {
    case ".pdf":
      return "pdf";
    case ".doc":
      return "doc";
    case ".docx":
    case ".docm":
      return "docx";
    case ".xls":
    case ".xlsx":
    case ".xlsm":
    case ".xlsb":
      return "xlsx";
    case ".csv":
      return "csv";
    case ".ppt":
    case ".pps":
    case ".pot":
      return "ppt";
    case ".pptx":
    case ".pptm":
    case ".ppsx":
    case ".ppsm":
      return "pptx";
    case ".odt":
      return "odt";
    case ".ods":
      return "ods";
    case ".odp":
      return "odp";
    case ".rtf":
      return "rtf";
    case ".epub":
      return "epub";
    default:
      return null;
  }
}

export async function convertDocumentBytes(
  bytes: Buffer | Uint8Array,
  options: ConvertDocumentBytesOptions = {},
): Promise<AnydocConvertResult> {
  const format =
    options.format ?? resolveAnydocFormat(options.mediaType, options.filename);
  const timeoutMs = options.timeoutMs ?? ANYDOC_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? ANYDOC_MAX_OUTPUT_BYTES;
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

  return withAnydocSlot(async () => {
    const convertFn =
      options.convertFn ??
      (async (bytes, resolvedFormat) => {
        const { toMarkdownBytes } = await import("@firecrawl/anydoc");
        // anydoc's Format const-enum typing is stricter than our string union.
        return toMarkdownBytes(
          bytes,
          resolvedFormat as Parameters<typeof toMarkdownBytes>[1],
        );
      });
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      const markdown = await Promise.race([
        convertFn(input, format),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("Document text extraction timed out.")),
            timeoutMs,
          );
        }),
      ]);

      const trimmed = markdown.trim();
      if (!trimmed) {
        return { text: "", truncated: false };
      }

      return truncateUtf8(trimmed, maxOutputBytes);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  });
}
