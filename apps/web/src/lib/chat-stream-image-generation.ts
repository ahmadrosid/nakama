import type { ImageGenerationAspect } from "@/components/chat/ImageGeneration";
import { toArtifactsRelativePath } from "@/lib/chat-artifacts";
import type { ChatListItem } from "@/lib/chat-history";

const GENERATE_IMAGE_TOOL_NAME = "generate_image";

type ImageGenerationToolStatus = "running" | "done" | "error";

export interface ImageGenerationToolState {
  artifactPath: string | null;
  aspect: ImageGenerationAspect;
  error: string | null;
  prompt: string;
  resolution: string;
  status: ImageGenerationToolStatus;
}

const DEFAULT_PROMPT = "a calm mountain lake at dawn";

const DEFAULT_SIZE = "1024x1024";

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type, anti-slop/no-unknown-parameters -- This function validates external JSON fields before callers use them.
function readRecord(value: unknown): Record<string, unknown> | null {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- This guard validates decoded external data before the caller uses the domain value.
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  // SAFETY: The enclosing parser checks the value before this conversion.
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- This dictionary holds external JSON keys until the boundary parser validates each value.
  return value as Record<string, unknown>;
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This parser decodes a field from an external tool result.
function readString(value: unknown): string | null {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- This guard validates decoded external data before the caller uses the domain value.
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function isGenerateImageTool(tool: string | undefined): boolean {
  return tool === GENERATE_IMAGE_TOOL_NAME;
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- The tool-call boundary supplies an unvalidated argument object.
export function parseGenerateImagePrompt(input: unknown): string | null {
  const record = readRecord(input);

  if (!record) {
    return null;
  }

  return readString(record.prompt);
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- The tool-call boundary supplies an unvalidated argument object.
export function parseGenerateImageSize(input: unknown): string | null {
  const record = readRecord(input);

  if (!record) {
    return null;
  }

  return readString(record.size);
}

/** Format tool size (`1024x1024`) as display resolution (`1024 × 1024`). */
export function formatImageGenerationResolution(size: string | null): string {
  const normalized = (size ?? DEFAULT_SIZE).trim().toLowerCase();

  if (!normalized || normalized === "auto") {
    return normalized === "auto" ? "auto" : "1024 × 1024";
  }

  const match = normalized.match(/^(\d+)\s*[x×]\s*(\d+)$/i);

  if (!match) {
    return size?.trim() || "1024 × 1024";
  }

  return `${match[1]} × ${match[2]}`;
}

export function imageGenerationAspectFromSize(
  size: string | null
): ImageGenerationAspect {
  const normalized = (size ?? DEFAULT_SIZE).trim().toLowerCase();
  const match = normalized.match(/^(\d+)\s*[x×]\s*(\d+)$/i);

  if (!match) {
    return "square";
  }

  const width = Number(match[1]);
  const height = Number(match[2]);

  if (!(width > 0 && height > 0)) {
    return "square";
  }

  if (width === height) {
    return "square";
  }

  return width > height ? "landscape" : "portrait";
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Error causes may come from browser or network code and are narrowed by this handler.
function parseGenerateImageError(result: unknown): string | null {
  const record = readRecord(result);

  if (!record) {
    return null;
  }

  return readString(record.error);
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This parser decodes a field from an external tool result.
function parseGenerateImagePath(result: unknown): string | null {
  const record = readRecord(result);

  if (!record) {
    return null;
  }

  const path = readString(record.path);

  if (!path) {
    return null;
  }

  return toArtifactsRelativePath(path) ?? path.replace(/^\.\//, "");
}

export function buildGenerateImageToolState(
  item: ChatListItem
): ImageGenerationToolState {
  const prompt = parseGenerateImagePrompt(item.toolInput) ?? DEFAULT_PROMPT;
  const size = parseGenerateImageSize(item.toolInput);
  const resolution = formatImageGenerationResolution(size);
  const aspect = imageGenerationAspectFromSize(size);

  if (item.toolStatus === "running") {
    return {
      artifactPath: null,
      aspect,
      error: null,
      prompt,
      resolution,
      status: "running",
    };
  }

  const error = parseGenerateImageError(item.toolResult);

  if (error) {
    return {
      artifactPath: null,
      aspect,
      error,
      prompt,
      resolution,
      status: "error",
    };
  }

  const relativePath = parseGenerateImagePath(item.toolResult);

  if (!relativePath) {
    return {
      artifactPath: null,
      aspect,
      error: "Image generation returned no path.",
      prompt,
      resolution,
      status: "error",
    };
  }

  return {
    artifactPath: relativePath,
    aspect,
    error: null,
    prompt,
    resolution,
    status: "done",
  };
}

export function shouldRenderGenerateImageToolRow(
  message: ChatListItem
): boolean {
  return isGenerateImageTool(message.tool);
}
