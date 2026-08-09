import type { ImageGenerationAspect } from "@/components/chat/ImageGeneration";
import {
  buildArtifactContentUrl,
  toArtifactsRelativePath,
} from "@/lib/chat-artifacts";
import type { ChatListItem } from "@/lib/chat-history";

export const GENERATE_IMAGE_TOOL_NAME = "generate_image";

export type ImageGenerationToolStatus = "running" | "done" | "error";

export interface ImageGenerationToolState {
  aspect: ImageGenerationAspect;
  error: string | null;
  imageUrl: string | null;
  prompt: string;
  resolution: string;
  status: ImageGenerationToolStatus;
}

const DEFAULT_PROMPT = "a calm mountain lake at dawn";
const DEFAULT_SIZE = "1024x1024";

function readRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function isGenerateImageTool(tool: string | undefined): boolean {
  return tool === GENERATE_IMAGE_TOOL_NAME;
}

export function parseGenerateImagePrompt(input: unknown): string | null {
  const record = readRecord(input);
  if (!record) {
    return null;
  }

  return readString(record.prompt);
}

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

function parseGenerateImageError(result: unknown): string | null {
  const record = readRecord(result);
  if (!record) {
    return null;
  }

  return readString(record.error);
}

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
  item: ChatListItem,
  profileId?: string | null
): ImageGenerationToolState {
  const prompt = parseGenerateImagePrompt(item.toolInput) ?? DEFAULT_PROMPT;
  const size = parseGenerateImageSize(item.toolInput);
  const resolution = formatImageGenerationResolution(size);
  const aspect = imageGenerationAspectFromSize(size);

  if (item.toolStatus === "running") {
    return {
      aspect,
      error: null,
      imageUrl: null,
      prompt,
      resolution,
      status: "running",
    };
  }

  const error = parseGenerateImageError(item.toolResult);
  if (error) {
    return {
      aspect,
      error,
      imageUrl: null,
      prompt,
      resolution,
      status: "error",
    };
  }

  const relativePath = parseGenerateImagePath(item.toolResult);
  const imageUrl =
    relativePath && profileId
      ? buildArtifactContentUrl(profileId, relativePath, true)
      : null;

  if (!imageUrl) {
    return {
      aspect,
      error: relativePath
        ? "Image ready, but preview is unavailable."
        : "Image generation returned no path.",
      imageUrl: null,
      prompt,
      resolution,
      status: "error",
    };
  }

  return {
    aspect,
    error: null,
    imageUrl,
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
