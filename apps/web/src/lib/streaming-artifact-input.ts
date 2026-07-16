import { toArtifactsRelativePath } from "@/lib/chat-artifacts";

const ARTIFACT_META_SUFFIX = ".nakama-meta.json";
const ARTIFACT_WRITE_TOOLS = new Set(["write_file", "write_docx"]);

export interface StreamingArtifactToolInput {
  eligible: boolean;
  relativePath: string | null;
  filename: string | null;
  content: string | null;
}

function isArtifactMetaRelativePath(relativePath: string): boolean {
  return (
    relativePath.endsWith(ARTIFACT_META_SUFFIX) ||
    relativePath.includes(".nakama-meta")
  );
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

function findJsonStringValue(source: string, key: string): string | null {
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
      return value;
    }

    if (char === "\\") {
      index += 1;

      if (index >= source.length) {
        return value;
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
            return value;
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

  return value;
}

function normalizeWritePath(path: string): string | null {
  const trimmed = path.trim().replace(/^\.\//, "");

  if (
    !trimmed.includes("artifacts/") &&
    !trimmed.includes("\\artifacts\\") &&
    !trimmed.startsWith("artifacts/")
  ) {
    return null;
  }

  return toArtifactsRelativePath(trimmed);
}

export function parseStreamingArtifactToolInput(
  tool: string | undefined,
  accumulatedJson: string,
): StreamingArtifactToolInput {
  const ineligible: StreamingArtifactToolInput = {
    eligible: false,
    relativePath: null,
    filename: null,
    content: null,
  };

  if (!tool || !ARTIFACT_WRITE_TOOLS.has(tool)) {
    return ineligible;
  }

  const contentField = contentFieldForTool(tool);

  if (!contentField) {
    return ineligible;
  }

  const rawPath = findJsonStringValue(accumulatedJson, "path");

  if (!rawPath) {
    const content = findJsonStringValue(accumulatedJson, contentField);
    return {
      eligible: false,
      relativePath: null,
      filename: null,
      content,
    };
  }

  const relativePath = normalizeWritePath(rawPath);

  if (!relativePath || !isArtifactRelativePath(relativePath)) {
    return ineligible;
  }

  const content = findJsonStringValue(accumulatedJson, contentField);
  const filename = relativePath.split("/").pop() ?? relativePath;

  return {
    eligible: true,
    relativePath,
    filename,
    content,
  };
}
