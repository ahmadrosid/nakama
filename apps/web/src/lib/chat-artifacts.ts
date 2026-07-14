import { inferArtifactMimeType } from "@nakama/core/artifact-mime";
import type { ChatListItem } from "@/lib/chat-history";

export {
  artifactCodeLanguage,
  inferArtifactMimeType,
  isDocxFile,
  isHtmlArtifactMimeType,
  isLegacyDocFile,
  isMarkdownArtifactMimeType,
  isTextArtifactMimeType,
  isUnknownArtifactMimeType,
  LEGACY_DOC_UNSUPPORTED_MESSAGE,
  looksLikeUtf8Text,
  resolveArtifactMimeType,
} from "@nakama/core/artifact-mime";

const ARTIFACT_META_SUFFIX = ".nakama-meta.json";
const ARTIFACTS_SEGMENT = "/artifacts/";
const ARTIFACTS_PREFIX = "artifacts/";
const ARTIFACT_PATH_IN_TEXT =
  /\bartifacts\/(?:[\w.-]+\/)*[\w.-]+\.[A-Za-z0-9][A-Za-z0-9._-]*\b/g;

export interface ChatArtifactRef {
  /** Basename for chip label (e.g. `report.md`). */
  filename: string;
  /** Path relative to the profile artifacts directory (e.g. `weekly/report.md`). */
  path: string;
  mimeType: string;
  sizeBytes: number;
  savedAt: string;
}

interface WriteFileResult {
  path?: string;
  bytesWritten?: number;
  error?: string;
}

function isWriteFileTool(message: ChatListItem): boolean {
  // write_docx reports the same { path, bytesWritten } result, so its output becomes
  // an artifact chip too.
  return (
    message.role === "tool" && (message.tool === "write_file" || message.tool === "write_docx")
  );
}

function getWriteFileResult(message: ChatListItem): WriteFileResult | null {
  if (!isWriteFileTool(message) || message.toolResult == null) {
    return null;
  }

  if (typeof message.toolResult !== "object" || message.toolResult === null) {
    return null;
  }

  return message.toolResult as WriteFileResult;
}

function isSuccessfulWrite(message: ChatListItem): boolean {
  const result = getWriteFileResult(message);
  return result != null && typeof result.error !== "string" && typeof result.path === "string";
}

function resolvedWritePath(message: ChatListItem): string | null {
  const result = getWriteFileResult(message);
  if (!result || typeof result.error === "string" || typeof result.path !== "string") {
    return null;
  }

  return result.path;
}

function bytesWrittenFromMessage(message: ChatListItem): number {
  const result = getWriteFileResult(message);
  if (!result || typeof result.bytesWritten !== "number" || !Number.isInteger(result.bytesWritten)) {
    return 0;
  }

  return Math.max(0, result.bytesWritten);
}

function isUnderArtifactsDir(resolvedPath: string): boolean {
  return (
    resolvedPath.includes(ARTIFACTS_SEGMENT) ||
    resolvedPath.startsWith(ARTIFACTS_PREFIX) ||
    resolvedPath.includes("\\artifacts\\")
  );
}

function isArtifactMetaRelativePath(relativePath: string): boolean {
  return relativePath.endsWith(ARTIFACT_META_SUFFIX);
}

function isArtifactMetaResolvedPath(resolvedPath: string): boolean {
  return isUnderArtifactsDir(resolvedPath) && resolvedPath.endsWith(ARTIFACT_META_SUFFIX);
}

export function toArtifactsRelativePath(resolvedPath: string): string | null {
  const markerIndex = resolvedPath.indexOf(ARTIFACTS_SEGMENT);
  if (markerIndex !== -1) {
    return resolvedPath.slice(markerIndex + ARTIFACTS_SEGMENT.length);
  }

  const windowsMarker = resolvedPath.toLowerCase().indexOf("\\artifacts\\");
  if (windowsMarker !== -1) {
    return resolvedPath.slice(windowsMarker + "\\artifacts\\".length).replace(/\\/g, "/");
  }

  if (resolvedPath.startsWith(ARTIFACTS_PREFIX)) {
    return resolvedPath.slice(ARTIFACTS_PREFIX.length);
  }

  return null;
}

function siblingContentPath(metaResolvedPath: string): string | null {
  if (!isArtifactMetaResolvedPath(metaResolvedPath)) {
    return null;
  }

  return metaResolvedPath.slice(0, -ARTIFACT_META_SUFFIX.length);
}

function parseArtifactMeta(content: unknown): Pick<ChatArtifactRef, "mimeType" | "sizeBytes" | "savedAt"> | null {
  if (typeof content !== "string" || !content.trim()) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  const mimeType = typeof record.mimeType === "string" ? record.mimeType.trim() : "";
  const savedAt = typeof record.savedAt === "string" ? record.savedAt.trim() : "";
  const sizeBytes = record.sizeBytes;

  if (!mimeType || !savedAt || typeof sizeBytes !== "number" || !Number.isInteger(sizeBytes) || sizeBytes < 0) {
    return null;
  }

  return { mimeType, savedAt, sizeBytes };
}

function metaContentFromSidecarWrite(message: ChatListItem): string | null {
  const input = message.toolInput;
  if (!input || typeof input.content !== "string") {
    return null;
  }

  return input.content;
}

function relativePathFromWriteMessage(message: ChatListItem): string | null {
  const resolvedPath = resolvedWritePath(message);
  if (resolvedPath) {
    const fromResolved = toArtifactsRelativePath(resolvedPath);
    if (fromResolved) {
      return fromResolved;
    }
  }

  const inputPath = message.toolInput?.path;
  if (typeof inputPath !== "string") {
    return null;
  }

  const normalized = inputPath.replace(/^\.\//, "");
  return toArtifactsRelativePath(normalized);
}

function buildArtifactRef(
  relativePath: string,
  meta: Pick<ChatArtifactRef, "mimeType" | "sizeBytes" | "savedAt">,
): ChatArtifactRef {
  const filename = relativePath.split("/").pop() ?? relativePath;
  return {
    filename,
    path: relativePath,
    mimeType: meta.mimeType,
    sizeBytes: meta.sizeBytes,
    savedAt: meta.savedAt,
  };
}

function inferredMetaForPath(relativePath: string, sizeBytes = 0): Pick<ChatArtifactRef, "mimeType" | "sizeBytes" | "savedAt"> {
  const filename = relativePath.split("/").pop() ?? relativePath;
  return {
    mimeType: inferArtifactMimeType(filename),
    sizeBytes,
    savedAt: "",
  };
}

/**
 * Extract `artifacts/...` path mentions from assistant message text.
 */
export function extractArtifactPathsFromText(content: string): string[] {
  const matches = content.match(ARTIFACT_PATH_IN_TEXT) ?? [];
  const paths: string[] = [];
  const seen = new Set<string>();

  for (const match of matches) {
    const relativePath = match.slice(ARTIFACTS_PREFIX.length);
    if (!relativePath || isArtifactMetaRelativePath(relativePath) || seen.has(relativePath)) {
      continue;
    }

    seen.add(relativePath);
    paths.push(relativePath);
  }

  return paths;
}

/**
 * Extract artifact chips from an assistant turn's tool messages and text.
 * Prefers content + `.nakama-meta.json` sidecar pairs; falls back to content-only
 * writes under artifacts/ and `artifacts/...` mentions in assistant text.
 */
export function extractTurnArtifacts(messages: ChatListItem[]): ChatArtifactRef[] {
  const contentWrites = new Map<string, { relativePath: string; sizeBytes: number }>();
  const artifactsByPath = new Map<string, ChatArtifactRef>();

  for (const message of messages) {
    if (!isSuccessfulWrite(message) || message.toolStatus === "running") {
      continue;
    }

    const resolvedPath = resolvedWritePath(message);
    if (!resolvedPath || isArtifactMetaResolvedPath(resolvedPath)) {
      continue;
    }

    const relativePath = relativePathFromWriteMessage(message);
    if (!relativePath || isArtifactMetaRelativePath(relativePath)) {
      continue;
    }

    contentWrites.set(resolvedPath, {
      relativePath,
      sizeBytes: bytesWrittenFromMessage(message),
    });
  }

  for (const message of messages) {
    if (!isSuccessfulWrite(message) || message.toolStatus === "running") {
      continue;
    }

    const resolvedPath = resolvedWritePath(message);
    if (!resolvedPath || !isArtifactMetaResolvedPath(resolvedPath)) {
      continue;
    }

    const siblingPath = siblingContentPath(resolvedPath);
    if (!siblingPath) {
      continue;
    }

    const contentWrite = contentWrites.get(siblingPath);
    if (!contentWrite) {
      continue;
    }

    const meta = parseArtifactMeta(metaContentFromSidecarWrite(message));
    if (!meta) {
      continue;
    }

    artifactsByPath.set(contentWrite.relativePath, buildArtifactRef(contentWrite.relativePath, meta));
  }

  for (const contentWrite of contentWrites.values()) {
    if (artifactsByPath.has(contentWrite.relativePath)) {
      continue;
    }

    artifactsByPath.set(
      contentWrite.relativePath,
      buildArtifactRef(contentWrite.relativePath, inferredMetaForPath(contentWrite.relativePath, contentWrite.sizeBytes)),
    );
  }

  for (const message of messages) {
    if (message.role !== "assistant" || !message.content.trim()) {
      continue;
    }

    for (const relativePath of extractArtifactPathsFromText(message.content)) {
      if (artifactsByPath.has(relativePath)) {
        continue;
      }

      artifactsByPath.set(relativePath, buildArtifactRef(relativePath, inferredMetaForPath(relativePath)));
    }
  }

  return [...artifactsByPath.values()];
}

export function buildArtifactContentUrl(profileId: string, artifactPath: string, inline = false): string {
  const query = new URLSearchParams({ path: artifactPath });
  if (inline) {
    query.set("inline", "1");
  }

  return `/v1/profiles/${encodeURIComponent(profileId)}/artifacts/content?${query.toString()}`;
}
