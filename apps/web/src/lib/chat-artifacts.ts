import { inferArtifactMimeType } from "@nakama/core/artifact-mime";
import type { ChatListItem } from "@/lib/chat-history";
import {
  type JsonRecord,
  readNumber,
  readRawString,
  readRecord,
  readString,
} from "@/lib/json-readers";

export const FILE_PREVIEW_MAX_BYTES = 8 * 1024 * 1024;

export {
  artifactCodeLanguage,
  inferArtifactMimeType,
  isDelimitedSpreadsheetFile,
  isDocxFile,
  isHtmlArtifactMimeType,
  isImageArtifactMimeType,
  isLegacyDocFile,
  isMarkdownArtifactMimeType,
  isTextArtifactMimeType,
  isUnknownArtifactMimeType,
  isVideoArtifactMimeType,
  looksLikeUtf8Text,
  resolveArtifactMimeType,
} from "@nakama/core/artifact-mime";

const ARTIFACT_META_SUFFIX = ".nakama-meta.json";

const ARTIFACTS_SEGMENT = "/artifacts/";

const ARTIFACTS_PREFIX = "artifacts/";

const ARTIFACT_PATH_IN_TEXT =
  /(?:\bprofiles\/([\w-]+)\/)?\bartifacts\/((?:[\w.-]+\/)*[\w.-]+\.[A-Za-z0-9][A-Za-z0-9._-]*)\b/g;

export interface ChatArtifactRef {
  /** Basename for chip label (e.g. `report.md`). */
  filename: string;
  mimeType: string;
  /**
   * Set when the reference names another profile (`profiles/<id>/artifacts/...`).
   * Bare paths belong to the chat profile.
   */
  ownerProfileId?: string;
  /** Path relative to the profile artifacts directory (e.g. `weekly/report.md`). */
  path: string;
  savedAt: string;
  sizeBytes: number;
}

function isWriteFileTool(message: ChatListItem): boolean {
  // write_docx reports the same { path, bytesWritten } result, so its output becomes
  // an artifact chip too.
  return (
    message.role === "tool" &&
    (message.tool === "write_file" ||
      message.tool === "write_docx" ||
      message.tool === "save_artifact")
  );
}

/** Tools whose result is one generated file: { path, mimeType, sizeBytes }. */
const GENERATED_MEDIA_TOOL_NAMES = new Set([
  "generate_image",
  "generate_video",
]);

function isGeneratedMediaTool(message: ChatListItem): boolean {
  return (
    message.role === "tool" &&
    GENERATED_MEDIA_TOOL_NAMES.has(message.tool ?? "")
  );
}

function getWriteFileResult(message: ChatListItem): JsonRecord | null {
  if (!isWriteFileTool(message) || message.toolResult == null) {
    return null;
  }

  return readRecord(message.toolResult);
}

function resolvedWritePath(message: ChatListItem): string | null {
  const result = getWriteFileResult(message);

  if (!result || readRawString(result.error) !== null) {
    return null;
  }

  return readRawString(result.path);
}

function isSuccessfulWrite(message: ChatListItem): boolean {
  return resolvedWritePath(message) !== null;
}

function bytesWrittenFromMessage(message: ChatListItem): number {
  const result = getWriteFileResult(message);

  if (!result) {
    return 0;
  }

  const bytesWritten = readNumber(result.bytesWritten);

  if (bytesWritten === null || !Number.isInteger(bytesWritten)) {
    return 0;
  }

  return Math.max(0, bytesWritten);
}

function isUnderArtifactsDir(resolvedPath: string): boolean {
  return (
    resolvedPath.includes(ARTIFACTS_SEGMENT) ||
    resolvedPath.startsWith(ARTIFACTS_PREFIX) ||
    resolvedPath.includes("\\artifacts\\")
  );
}

function isArtifactMetaRelativePath(relativePath: string): boolean {
  return (
    relativePath.endsWith(ARTIFACT_META_SUFFIX) ||
    relativePath.includes(".nakama-meta")
  );
}

function isArtifactMetaResolvedPath(resolvedPath: string): boolean {
  return (
    isUnderArtifactsDir(resolvedPath) &&
    (resolvedPath.endsWith(ARTIFACT_META_SUFFIX) ||
      resolvedPath.includes(".nakama-meta"))
  );
}

/** True when a tool message is writing/reading an artifact metadata sidecar (internal). */
export function isArtifactMetaSidecarTool(message: ChatListItem): boolean {
  if (message.tool !== "write_file" && message.tool !== "write_docx") {
    return false;
  }

  const inputPath = readRawString(message.toolInput?.path);

  if (
    inputPath &&
    (inputPath.includes(".nakama-meta") ||
      inputPath.endsWith(ARTIFACT_META_SUFFIX))
  ) {
    return true;
  }

  const resultPath = readRawString(readRecord(message.toolResult)?.path);

  if (resultPath !== null) {
    return (
      resultPath.includes(".nakama-meta") ||
      resultPath.endsWith(ARTIFACT_META_SUFFIX)
    );
  }

  return false;
}

export function toArtifactsRelativePath(resolvedPath: string): string | null {
  const markerIndex = resolvedPath.indexOf(ARTIFACTS_SEGMENT);

  if (markerIndex !== -1) {
    return resolvedPath.slice(markerIndex + ARTIFACTS_SEGMENT.length);
  }

  const windowsMarker = resolvedPath.toLowerCase().indexOf("\\artifacts\\");

  if (windowsMarker !== -1) {
    return resolvedPath
      .slice(windowsMarker + "\\artifacts\\".length)
      .replace(/\\/g, "/");
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

function parseArtifactMeta(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This parser accepts untrusted provider or tool output and decodes it at this boundary.
  content: unknown
): Pick<ChatArtifactRef, "mimeType" | "sizeBytes" | "savedAt"> | null {
  const text = readRawString(content);

  if (!text?.trim()) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  const record = readRecord(parsed);

  if (!record) {
    return null;
  }

  const mimeType = readString(record.mimeType) ?? "";
  const savedAt = readString(record.savedAt) ?? "";
  const sizeBytes = readNumber(record.sizeBytes);

  if (
    !(mimeType && savedAt) ||
    sizeBytes === null ||
    !Number.isInteger(sizeBytes) ||
    sizeBytes < 0
  ) {
    return null;
  }

  return { mimeType, savedAt, sizeBytes };
}

function metaContentFromSidecarWrite(message: ChatListItem): string | null {
  return readRawString(message.toolInput?.content);
}

function relativePathFromWriteMessage(message: ChatListItem): string | null {
  const resolvedPath = resolvedWritePath(message);

  if (resolvedPath) {
    const fromResolved = toArtifactsRelativePath(resolvedPath);

    if (fromResolved) {
      return fromResolved;
    }
  }

  const inputPath = readRawString(message.toolInput?.path);

  if (inputPath === null) {
    return null;
  }

  const normalized = inputPath.replace(/^\.\//, "");

  return toArtifactsRelativePath(normalized);
}

function buildArtifactRef(
  relativePath: string,
  meta: Pick<ChatArtifactRef, "mimeType" | "sizeBytes" | "savedAt">,
  ownerProfileId?: string
): ChatArtifactRef {
  const filename = relativePath.split("/").pop() ?? relativePath;

  return {
    filename,
    mimeType: meta.mimeType,
    // oxlint-disable-next-line anti-slop/no-conditional-empty-object-spread -- This optional field must stay absent when no value exists to preserve the wire payload contract.
    ...(ownerProfileId ? { ownerProfileId } : {}),
    path: relativePath,
    savedAt: meta.savedAt,
    sizeBytes: meta.sizeBytes,
  };
}

function getGenerateImageResult(message: ChatListItem): JsonRecord | null {
  if (!isGeneratedMediaTool(message) || message.toolResult == null) {
    return null;
  }

  return readRecord(message.toolResult);
}

function artifactRefFromGenerateImage(
  message: ChatListItem
): ChatArtifactRef | null {
  if (message.toolStatus === "running") {
    return null;
  }

  const result = getGenerateImageResult(message);

  if (!result || readRawString(result.error) !== null) {
    return null;
  }

  const path = readString(result.path);

  if (!path) {
    return null;
  }

  const mimeType = readString(result.mimeType) ?? "";

  if (!mimeType) {
    return null;
  }

  const sizeBytes = readNumber(result.sizeBytes);

  if (sizeBytes === null || !Number.isInteger(sizeBytes) || sizeBytes < 0) {
    return null;
  }

  const relativePath = toArtifactsRelativePath(path);

  if (!relativePath || isArtifactMetaRelativePath(relativePath)) {
    return null;
  }

  return buildArtifactRef(relativePath, {
    mimeType,
    savedAt: "",
    sizeBytes,
  });
}

function inferredMetaForPath(
  relativePath: string,
  sizeBytes = 0
): Pick<ChatArtifactRef, "mimeType" | "sizeBytes" | "savedAt"> {
  const filename = relativePath.split("/").pop() ?? relativePath;

  return {
    mimeType: inferArtifactMimeType(filename),
    savedAt: "",
    sizeBytes,
  };
}

/**
 * Extract `artifacts/...` and `profiles/<id>/artifacts/...` mentions from
 * assistant message text.
 */
export function extractArtifactPathsFromText(
  content: string
): Array<{ path: string; ownerProfileId?: string }> {
  const refs: Array<{ path: string; ownerProfileId?: string }> = [];
  const seen = new Set<string>();

  for (const match of content.matchAll(ARTIFACT_PATH_IN_TEXT)) {
    const [, ownerProfileId, relativePath] = match;
    const key = `${ownerProfileId ?? ""}:${relativePath}`;

    if (
      !relativePath ||
      isArtifactMetaRelativePath(relativePath) ||
      seen.has(key)
    ) {
      continue;
    }

    seen.add(key);
    refs.push(
      ownerProfileId
        ? { ownerProfileId, path: relativePath }
        : { path: relativePath }
    );
  }

  return refs;
}

/**
 * Extract artifact chips from an assistant turn's tool messages and text.
 * Prefers content + `.nakama-meta.json` sidecar pairs; falls back to content-only
 * writes under artifacts/ and `artifacts/...` mentions in assistant text.
 */
export function extractTurnArtifacts(
  messages: ChatListItem[]
): ChatArtifactRef[] {
  const contentWrites = new Map<
    string,
    { relativePath: string; sizeBytes: number }
  >();

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

    if (!(resolvedPath && isArtifactMetaResolvedPath(resolvedPath))) {
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

    artifactsByPath.set(
      contentWrite.relativePath,
      buildArtifactRef(contentWrite.relativePath, meta)
    );
  }

  for (const contentWrite of contentWrites.values()) {
    if (artifactsByPath.has(contentWrite.relativePath)) {
      continue;
    }

    artifactsByPath.set(
      contentWrite.relativePath,
      buildArtifactRef(
        contentWrite.relativePath,
        inferredMetaForPath(contentWrite.relativePath, contentWrite.sizeBytes)
      )
    );
  }

  for (const message of messages) {
    const generated = artifactRefFromGenerateImage(message);

    if (!generated) {
      continue;
    }

    artifactsByPath.set(generated.path, generated);
  }

  for (const message of messages) {
    if (message.role !== "assistant" || !message.content.trim()) {
      continue;
    }

    for (const { path, ownerProfileId } of extractArtifactPathsFromText(
      message.content
    )) {
      // Same relative path in two profiles is two files.
      const key = ownerProfileId ? `profiles/${ownerProfileId}/${path}` : path;

      if (artifactsByPath.has(key)) {
        continue;
      }

      artifactsByPath.set(
        key,
        buildArtifactRef(path, inferredMetaForPath(path), ownerProfileId)
      );
    }
  }

  return [...artifactsByPath.values()];
}

export function buildArtifactContentUrl(
  profileId: string,
  artifactPath: string,
  inline = false
): string {
  const query = new URLSearchParams({ path: artifactPath });

  if (inline) {
    query.set("inline", "1");
  }

  return `/v1/profiles/${encodeURIComponent(profileId)}/artifacts/content?${query.toString()}`;
}
