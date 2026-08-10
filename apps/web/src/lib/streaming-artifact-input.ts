import { toArtifactsRelativePath } from "@/lib/chat-artifacts";

const ARTIFACT_META_SUFFIX = ".nakama-meta.json";
/**
 * Shortest distinctive prefix of the meta suffix we reject while the path is
 * still streaming (e.g. `report.md.nak` before `.nakama-meta.json` completes).
 */
const ARTIFACT_META_PREFIX = ".nak";
const ARTIFACT_WRITE_TOOLS = new Set(["write_file", "write_docx"]);

export interface StreamingArtifactToolInput {
  content: string | null;
  eligible: boolean;
  filename: string | null;
  relativePath: string | null;
}

interface JsonStringValue {
  /** True when the JSON string literal was closed with an unescaped `"`. */
  complete: boolean;
  value: string;
}

function isArtifactMetaRelativePath(relativePath: string): boolean {
  if (
    relativePath.includes(".nakama-meta") ||
    relativePath.endsWith(ARTIFACT_META_SUFFIX)
  ) {
    return true;
  }

  // While path is still streaming, reject prefixes like `.nak` / `.nakama-m`.
  for (
    let length = ARTIFACT_META_PREFIX.length;
    length < ARTIFACT_META_SUFFIX.length;
    length += 1
  ) {
    if (relativePath.endsWith(ARTIFACT_META_SUFFIX.slice(0, length))) {
      return true;
    }
  }

  return false;
}

function isArtifactRelativePath(relativePath: string): boolean {
  return relativePath.length > 0 && !isArtifactMetaRelativePath(relativePath);
}

function contentFieldForTool(tool: string): "content" | "markdown" | null {
  if (tool === "write_file") {
    return "content";
  }

  if (tool === "write_docx") {
    return "markdown";
  }

  return null;
}

function findJsonStringValue(
  source: string,
  key: string
): JsonStringValue | null {
  const keyPattern = new RegExp(`"${key}"\\s*:\\s*"`);
  const match = keyPattern.exec(source);

  if (!match || match.index === undefined) {
    return null;
  }

  let index = match.index + match[0].length;
  let value = "";

  while (index < source.length) {
    const char = source[index];

    if (char === '"') {
      return { complete: true, value };
    }

    if (char === "\\") {
      index += 1;

      if (index >= source.length) {
        return { complete: false, value };
      }

      const escaped = source[index];

      switch (escaped) {
        case '"':
          value += '"';
          break;
        case "\\":
          value += "\\";
          break;
        case "n":
          value += "\n";
          break;
        case "r":
          value += "\r";
          break;
        case "t":
          value += "\t";
          break;
        case "b":
          value += "\b";
          break;
        case "f":
          value += "\f";
          break;
        case "u": {
          const hex = source.slice(index + 1, index + 5);

          if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) {
            return { complete: false, value };
          }

          value += String.fromCharCode(Number.parseInt(hex, 16));
          index += 4;
          break;
        }
        default:
          value += escaped;
          break;
      }

      index += 1;
      continue;
    }

    value += char;
    index += 1;
  }

  return { complete: false, value };
}

function normalizeWritePath(path: string): string | null {
  const trimmed = path.trim().replace(/^\.\//, "");

  if (
    !(
      trimmed.includes("artifacts/") ||
      trimmed.includes("\\artifacts\\") ||
      trimmed.startsWith("artifacts/")
    )
  ) {
    return null;
  }

  return toArtifactsRelativePath(trimmed);
}

export function parseStreamingArtifactToolInput(
  tool: string | undefined,
  accumulatedJson: string
): StreamingArtifactToolInput {
  const ineligible: StreamingArtifactToolInput = {
    content: null,
    eligible: false,
    filename: null,
    relativePath: null,
  };

  if (!(tool && ARTIFACT_WRITE_TOOLS.has(tool))) {
    return ineligible;
  }

  const contentField = contentFieldForTool(tool);

  if (!contentField) {
    return ineligible;
  }

  const rawPath = findJsonStringValue(accumulatedJson, "path");
  const content =
    findJsonStringValue(accumulatedJson, contentField)?.value ?? null;

  if (!rawPath) {
    return {
      content,
      eligible: false,
      filename: null,
      relativePath: null,
    };
  }

  // Path must be a complete JSON string. Otherwise a sidecar write briefly looks
  // like `artifacts/report.md` before `.nakama-meta.json` is appended, and the
  // preview panel would open on internal metadata.
  if (!rawPath.complete) {
    return {
      content,
      eligible: false,
      filename: null,
      relativePath: null,
    };
  }

  const relativePath = normalizeWritePath(rawPath.value);

  if (!(relativePath && isArtifactRelativePath(relativePath))) {
    return ineligible;
  }

  const filename = relativePath.split("/").pop() ?? relativePath;

  return {
    content,
    eligible: true,
    filename,
    relativePath,
  };
}
