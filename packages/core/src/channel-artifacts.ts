import type { ChatMessage } from "./contract";

const ARTIFACT_META_SUFFIX = ".nakama-meta.json";
const ARTIFACTS_SEGMENT = "/artifacts/";
const ARTIFACTS_PREFIX = "artifacts/";

export interface ChannelArtifactRef {
  filename: string;
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

function parseToolResult(content: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return null;
  }
}

function isWriteFileToolName(name: string): boolean {
  return name === "write_file" || name === "write_docx";
}

function getWriteFileResult(message: Extract<ChatMessage, { role: "tool" }>): WriteFileResult | null {
  const parsed = parseToolResult(message.content);

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  return parsed as WriteFileResult;
}

function isSuccessfulWrite(message: Extract<ChatMessage, { role: "tool" }>): boolean {
  const result = getWriteFileResult(message);
  return result != null && typeof result.error !== "string" && typeof result.path === "string";
}

function resolvedWritePath(message: Extract<ChatMessage, { role: "tool" }>): string | null {
  const result = getWriteFileResult(message);
  if (!result || typeof result.error === "string" || typeof result.path !== "string") {
    return null;
  }

  return result.path;
}

function isUnderArtifactsDir(resolvedPath: string): boolean {
  return (
    resolvedPath.includes(ARTIFACTS_SEGMENT) ||
    resolvedPath.startsWith(ARTIFACTS_PREFIX) ||
    resolvedPath.includes("\\artifacts\\")
  );
}

function isArtifactMetaRelativePath(relativePath: string): boolean {
  return relativePath.endsWith(ARTIFACT_META_SUFFIX) || relativePath.includes(".nakama-meta");
}

function isArtifactMetaResolvedPath(resolvedPath: string): boolean {
  return (
    isUnderArtifactsDir(resolvedPath) &&
    (resolvedPath.endsWith(ARTIFACT_META_SUFFIX) || resolvedPath.includes(".nakama-meta"))
  );
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

function parseArtifactMeta(content: unknown): Pick<ChannelArtifactRef, "mimeType" | "sizeBytes" | "savedAt"> | null {
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

function buildArtifactRef(
  relativePath: string,
  meta: Pick<ChannelArtifactRef, "mimeType" | "sizeBytes" | "savedAt">,
): ChannelArtifactRef {
  const filename = relativePath.split("/").pop() ?? relativePath;
  return {
    filename,
    path: relativePath,
    mimeType: meta.mimeType,
    sizeBytes: meta.sizeBytes,
    savedAt: meta.savedAt,
  };
}

function relativePathFromWriteMessage(
  message: Extract<ChatMessage, { role: "tool" }>,
  toolInputs: Map<string, Record<string, unknown>>,
): string | null {
  const resolvedPath = resolvedWritePath(message);
  if (resolvedPath) {
    const fromResolved = toArtifactsRelativePath(resolvedPath);
    if (fromResolved) {
      return fromResolved;
    }
  }

  const input = toolInputs.get(message.toolCallId);
  const inputPath = typeof input?.path === "string" ? input.path : null;
  if (!inputPath) {
    return null;
  }

  const normalized = inputPath.replace(/^\.\//, "");
  return toArtifactsRelativePath(normalized);
}

function metaContentFromSidecarWrite(
  message: Extract<ChatMessage, { role: "tool" }>,
  toolInputs: Map<string, Record<string, unknown>>,
): string | null {
  const input = toolInputs.get(message.toolCallId);
  if (!input || typeof input.content !== "string") {
    return null;
  }

  return input.content;
}

function buildToolInputMap(messages: ChatMessage[]): Map<string, Record<string, unknown>> {
  const toolInputs = new Map<string, Record<string, unknown>>();

  for (const message of messages) {
    if (message.role !== "assistant") {
      continue;
    }

    for (const call of message.toolCalls ?? []) {
      toolInputs.set(call.id, call.arguments);
    }
  }

  return toolInputs;
}

/** Messages belonging to the latest user turn (from last user message through end). */
export function extractLatestTurnMessages(messages: ChatMessage[]): ChatMessage[] {
  let lastUserIndex = -1;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      lastUserIndex = index;
      break;
    }
  }

  if (lastUserIndex === -1) {
    return messages;
  }

  return messages.slice(lastUserIndex);
}

/**
 * Extract save-artifact pairs (content + `.nakama-meta.json` sidecar) from chat history.
 * Strict pairing only — no content-only or assistant-text fallbacks.
 */
export function extractPairedTurnArtifacts(messages: ChatMessage[]): ChannelArtifactRef[] {
  const turnMessages = extractLatestTurnMessages(messages);
  const toolInputs = buildToolInputMap(messages);
  const contentWrites = new Map<string, { relativePath: string }>();
  const artifactsByPath = new Map<string, ChannelArtifactRef>();

  for (const message of turnMessages) {
    if (message.role !== "tool" || !isWriteFileToolName(message.name) || !isSuccessfulWrite(message)) {
      continue;
    }

    const resolvedPath = resolvedWritePath(message);
    if (!resolvedPath || isArtifactMetaResolvedPath(resolvedPath)) {
      continue;
    }

    const relativePath = relativePathFromWriteMessage(message, toolInputs);
    if (!relativePath || isArtifactMetaRelativePath(relativePath)) {
      continue;
    }

    contentWrites.set(resolvedPath, { relativePath });
  }

  for (const message of turnMessages) {
    if (message.role !== "tool" || !isWriteFileToolName(message.name) || !isSuccessfulWrite(message)) {
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

    const meta = parseArtifactMeta(metaContentFromSidecarWrite(message, toolInputs));
    if (!meta) {
      continue;
    }

    artifactsByPath.set(contentWrite.relativePath, buildArtifactRef(contentWrite.relativePath, meta));
  }

  return [...artifactsByPath.values()];
}
