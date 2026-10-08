import { z } from "zod";
import { inferArtifactMimeType } from "./artifact-mime";
import type { ChatMessage } from "./contract";

const ARTIFACT_META_SUFFIX = ".nakama-meta.json";

const ARTIFACTS_SEGMENT = "/artifacts/";

const ARTIFACTS_PREFIX = "artifacts/";

const JsonValueSchema = z.json();

const JsonObjectSchema = z.record(z.string(), JsonValueSchema);

const WriteFileResultSchema = z.object({
  bytesWritten: z.number().optional(),
  error: z.string().optional(),
  path: z.string().optional(),
});

const GenerateImageResultSchema = z.object({
  error: z.string().optional(),
  mimeType: z.string().optional(),
  path: z.string().optional(),
  sizeBytes: z.number().optional(),
});

type JsonObject = z.infer<typeof JsonObjectSchema>;

/** Filenames that look like agent scratch, never user-facing deliverables. */
export function isScratchArtifactPath(relativePath: string): boolean {
  const filename = relativePath.split("/").pop() ?? relativePath;

  return (
    filename.startsWith(".") ||
    filename.startsWith("_") ||
    filename.startsWith("~") ||
    filename.endsWith("~") ||
    filename.endsWith(".tmp") ||
    filename.endsWith(".bak") ||
    filename.endsWith(".swp")
  );
}

export interface ChannelArtifactRef {
  filename: string;
  mimeType: string;
  path: string;
  savedAt: string;
  sizeBytes: number;
}

type WriteFileResult = z.infer<typeof WriteFileResultSchema>;

type GenerateImageResult = z.infer<typeof GenerateImageResultSchema>;

function parseToolResult(content: string): JsonObject | null {
  try {
    const parsed = JsonObjectSchema.safeParse(JSON.parse(content));

    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function isWriteFileToolName(name: string): boolean {
  return name === "write_file" || name === "write_docx";
}

function isGenerateImageToolName(name: string): boolean {
  return name === "generate_image";
}

function getWriteFileResult(
  message: Extract<ChatMessage, { role: "tool" }>
): WriteFileResult | null {
  const parsed = parseToolResult(message.content);

  const result = WriteFileResultSchema.safeParse(parsed);

  return result.success ? result.data : null;
}

function isSuccessfulWrite(
  message: Extract<ChatMessage, { role: "tool" }>
): boolean {
  const result = getWriteFileResult(message);

  return (
    result !== null && result.error === undefined && result.path !== undefined
  );
}

function resolvedWritePath(
  message: Extract<ChatMessage, { role: "tool" }>
): string | null {
  const result = getWriteFileResult(message);

  if (!result || result.error !== undefined || result.path === undefined) {
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
  content: string
): Pick<ChannelArtifactRef, "mimeType" | "sizeBytes" | "savedAt"> | null {
  if (!content.trim()) {
    return null;
  }

  let parsed: JsonObject;

  try {
    parsed = JsonObjectSchema.parse(JSON.parse(content));
  } catch {
    return null;
  }

  const mimeType = z.string().safeParse(parsed.mimeType).data?.trim() ?? "";
  const savedAt = z.string().safeParse(parsed.savedAt).data?.trim() ?? "";
  const sizeBytes = z.number().safeParse(parsed.sizeBytes);

  if (
    !(
      mimeType &&
      savedAt &&
      sizeBytes.success &&
      Number.isInteger(sizeBytes.data) &&
      sizeBytes.data >= 0
    )
  ) {
    return null;
  }

  return { mimeType, savedAt, sizeBytes: sizeBytes.data };
}

function buildArtifactRef(
  relativePath: string,
  meta: Pick<ChannelArtifactRef, "mimeType" | "sizeBytes" | "savedAt">
): ChannelArtifactRef {
  const filename = relativePath.split("/").pop() ?? relativePath;

  return {
    filename,
    mimeType: meta.mimeType,
    path: relativePath,
    savedAt: meta.savedAt,
    sizeBytes: meta.sizeBytes,
  };
}

function relativePathFromWriteMessage(
  message: Extract<ChatMessage, { role: "tool" }>,
  toolInputs: Map<string, JsonObject>
): string | null {
  const resolvedPath = resolvedWritePath(message);

  if (resolvedPath) {
    const fromResolved = toArtifactsRelativePath(resolvedPath);

    if (fromResolved) {
      return fromResolved;
    }
  }

  const input = toolInputs.get(message.toolCallId);
  const inputPath = z.string().safeParse(input?.path).data ?? null;

  if (!inputPath) {
    return null;
  }

  const normalized = inputPath.replace(/^\.\//, "");

  return toArtifactsRelativePath(normalized);
}

function metaContentFromSidecarWrite(
  message: Extract<ChatMessage, { role: "tool" }>,
  toolInputs: Map<string, JsonObject>
): string | null {
  const input = toolInputs.get(message.toolCallId);

  if (!input) {
    return null;
  }

  return z.string().safeParse(input.content).data ?? null;
}

function buildToolInputMap(messages: ChatMessage[]): Map<string, JsonObject> {
  const toolInputs = new Map<string, JsonObject>();

  for (const message of messages) {
    if (message.role !== "assistant") {
      continue;
    }

    for (const call of message.toolCalls ?? []) {
      const args = JsonObjectSchema.safeParse(call.arguments);

      if (args.success) {
        toolInputs.set(call.id, args.data);
      }
    }
  }

  return toolInputs;
}

function getGenerateImageResult(
  message: Extract<ChatMessage, { role: "tool" }>
): GenerateImageResult | null {
  const parsed = parseToolResult(message.content);

  const result = GenerateImageResultSchema.safeParse(parsed);

  return result.success ? result.data : null;
}

function artifactRefFromGenerateImage(
  message: Extract<ChatMessage, { role: "tool" }>
): ChannelArtifactRef | null {
  if (!isGenerateImageToolName(message.name)) {
    return null;
  }

  const result = getGenerateImageResult(message);

  if (!result || result.error !== undefined) {
    return null;
  }

  if (!result.path?.trim()) {
    return null;
  }

  const mimeType = result.mimeType?.trim() ?? "";

  if (!mimeType) {
    return null;
  }

  if (
    result.sizeBytes === undefined ||
    !Number.isInteger(result.sizeBytes) ||
    result.sizeBytes < 0
  ) {
    return null;
  }

  const relativePath = toArtifactsRelativePath(result.path.trim());

  if (!relativePath || isArtifactMetaRelativePath(relativePath)) {
    return null;
  }

  return buildArtifactRef(relativePath, {
    mimeType,
    savedAt: "",
    sizeBytes: result.sizeBytes,
  });
}

/** Messages belonging to the latest user turn (from last user message through end). */
export function extractLatestTurnMessages(
  messages: ChatMessage[]
): ChatMessage[] {
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
 * Extract successful artifact writes from chat history. Complete sidecars override
 * metadata inferred from the write result; assistant text never counts as a write.
 */
export function extractPairedTurnArtifacts(
  messages: ChatMessage[]
): ChannelArtifactRef[] {
  const turnMessages = extractLatestTurnMessages(messages);
  const toolInputs = buildToolInputMap(messages);
  const contentWrites = new Map<string, { relativePath: string }>();
  const artifactsByPath = new Map<string, ChannelArtifactRef>();

  for (const message of turnMessages) {
    if (
      message.role !== "tool" ||
      !isWriteFileToolName(message.name) ||
      !isSuccessfulWrite(message)
    ) {
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
    const sizeBytes = getWriteFileResult(message)?.bytesWritten;

    if (
      sizeBytes !== undefined &&
      Number.isInteger(sizeBytes) &&
      sizeBytes >= 0
    ) {
      artifactsByPath.set(
        relativePath,
        buildArtifactRef(relativePath, {
          mimeType: inferArtifactMimeType(relativePath),
          savedAt: "",
          sizeBytes,
        })
      );
    }
  }

  for (const message of turnMessages) {
    if (
      message.role !== "tool" ||
      !isWriteFileToolName(message.name) ||
      !isSuccessfulWrite(message)
    ) {
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

    const metaContent = metaContentFromSidecarWrite(message, toolInputs);

    if (metaContent === null) {
      continue;
    }

    const meta = parseArtifactMeta(metaContent);

    if (!meta) {
      continue;
    }

    artifactsByPath.set(
      contentWrite.relativePath,
      buildArtifactRef(contentWrite.relativePath, meta)
    );
  }

  for (const message of turnMessages) {
    if (message.role !== "tool") {
      continue;
    }

    const generated = artifactRefFromGenerateImage(message);

    if (!generated) {
      continue;
    }

    artifactsByPath.set(generated.path, generated);
  }

  return [...artifactsByPath.values()];
}
