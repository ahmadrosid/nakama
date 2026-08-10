import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  getProfileSoulDir,
  MAX_IMAGE_BYTES,
  NakamaApiError,
  pathExists,
  type ToolContext,
  type ToolDefinition,
  type UserConfig,
} from "@nakama/core";
import type { DatabaseAdapter } from "@nakama/db";
import { createAttachmentSaver } from "../services/attachment-service";
import {
  generateImageWithOpenAI,
  IMAGE_GENERATION_SIZES,
  IMAGE_MODEL_REQUIRED_MESSAGE,
  normalizeImageGenerationSize,
  resolveImageGenerationSelection,
} from "../services/image-generation";

export const GENERATE_IMAGE_TOOL_NAME = "generate_image";

const ARTIFACT_META_SUFFIX = ".nakama-meta.json";
const DEFAULT_FILENAME = "generated-image.png";

export interface GenerateImageToolInput {
  filename?: string;
  prompt: string;
  size?: string;
}

export interface GenerateImageToolSuccess {
  attachmentId: string | null;
  mimeType: string;
  model: string;
  path: string;
  sizeBytes: number;
}

export interface GenerateImageToolFailure {
  error: string;
}

export type GenerateImageToolOutput =
  | GenerateImageToolSuccess
  | GenerateImageToolFailure;

export interface GenerateImageToolDeps {
  db: DatabaseAdapter;
  ensureSettingsLoaded: () => Promise<void>;
  /** Test seam — defaults to live OpenAI Images call. */
  generateImage?: typeof generateImageWithOpenAI;
  getUserConfig: () => UserConfig | null | undefined;
  recordUsage?: (
    modelId: string,
    inputTokens: number,
    outputTokens: number
  ) => void;
}

export function createGenerateImageTool(
  deps: GenerateImageToolDeps
): ToolDefinition {
  return {
    description:
      "Generate an image from a text prompt using the workspace image model (OpenAI gpt-image-2). Saves a PNG under artifacts/ with a metadata sidecar and session attachment when available. Model is configured in Settings — do not pass a model name.",
    name: GENERATE_IMAGE_TOOL_NAME,
    parallelSafe: false,
    parameters: {
      additionalProperties: false,
      properties: {
        filename: {
          description:
            "Optional output filename under artifacts/ (defaults to a generated .png name).",
          type: "string",
        },
        prompt: {
          description: "Text description of the image to generate.",
          type: "string",
        },
        size: {
          description: `Optional image size. Allowed: ${IMAGE_GENERATION_SIZES.join(", ")}.`,
          type: "string",
        },
      },
      required: ["prompt"],
      type: "object",
    },
    async run(input, context) {
      return runGenerateImageTool(input, context, deps);
    },
  };
}

export async function runGenerateImageTool(
  input: unknown,
  context: ToolContext,
  deps: GenerateImageToolDeps
): Promise<GenerateImageToolOutput> {
  const prompt = readString(input, "prompt")?.trim();
  if (!prompt) {
    return { error: "prompt is required." };
  }

  if (hasOwnKey(input, "model")) {
    return {
      error:
        "model is not a generate_image parameter; configure it in Settings.",
    };
  }

  const orgId = context.orgId?.trim();
  const profileId = context.profileId?.trim();
  if (!(orgId && profileId)) {
    return { error: "orgId and profileId are required." };
  }

  const sizeRaw = readString(input, "size")?.trim();
  let size: string;
  try {
    size = normalizeImageGenerationSize(sizeRaw);
  } catch (error) {
    return { error: errorMessage(error) };
  }

  const filenameHint = readString(input, "filename");

  await deps.ensureSettingsLoaded();

  let selection;
  try {
    selection = resolveImageGenerationSelection(deps.getUserConfig());
  } catch (error) {
    return { error: errorMessage(error) };
  }

  if (!selection) {
    return { error: IMAGE_MODEL_REQUIRED_MESSAGE };
  }

  const generate = deps.generateImage ?? generateImageWithOpenAI;
  let result;
  try {
    result = await generate({
      apiKey: selection.apiKey,
      model: selection.model,
      prompt,
      size,
    });
  } catch (error) {
    return { error: errorMessage(error) };
  }

  if (result.data.byteLength === 0) {
    return { error: "Image generation returned empty image data." };
  }

  if (result.data.byteLength > MAX_IMAGE_BYTES) {
    return {
      error: `Generated image exceeds the ${MAX_IMAGE_BYTES / (1024 * 1024)} MB size limit.`,
    };
  }

  const workspaceRoot =
    context.workspaceRoot?.trim() || getProfileSoulDir(orgId, profileId);
  const artifactsDir = path.join(workspaceRoot, "artifacts");
  const outputName = resolveOutputFilename(filenameHint, result.mediaType);
  const targetPath = await uniqueArtifactPath(
    path.join(artifactsDir, outputName)
  );
  const relativePath = normalizeRelativePath(
    path.relative(workspaceRoot, targetPath)
  );
  const metaPath = `${targetPath}${ARTIFACT_META_SUFFIX}`;
  const savedAt = new Date().toISOString();
  const sizeBytes = result.data.byteLength;

  await mkdir(artifactsDir, { recursive: true });

  try {
    await writeFile(targetPath, result.data);
    await writeFile(
      metaPath,
      JSON.stringify(
        {
          mimeType: result.mediaType,
          savedAt,
          sizeBytes,
        },
        null,
        2
      ),
      "utf8"
    );
  } catch (error) {
    await cleanupArtifactPair(targetPath, metaPath);
    return { error: errorMessage(error) };
  }

  let attachmentId: string | null = null;
  const sessionId = context.sessionId?.trim();
  const channel = context.channel;

  if (sessionId && channel) {
    try {
      const save = createAttachmentSaver(deps.db, {
        channel,
        orgId,
        profileId,
        sessionId,
      });
      const saved = await save({
        bytes: Buffer.from(result.data),
        filename: path.basename(targetPath),
        kind: "image",
        mediaType: result.mediaType,
      });
      attachmentId = saved.attachmentId;
    } catch (error) {
      await cleanupArtifactPair(targetPath, metaPath);
      return { error: errorMessage(error) };
    }
  }

  if (result.usage && deps.recordUsage) {
    deps.recordUsage(
      result.model,
      result.usage.inputTokens,
      result.usage.outputTokens
    );
  }

  return {
    attachmentId,
    mimeType: result.mediaType,
    model: result.model,
    path: relativePath,
    sizeBytes,
  };
}

async function uniqueArtifactPath(filePath: string): Promise<string> {
  if (!(await pathExists(filePath))) {
    return filePath;
  }

  const date = new Date().toISOString().slice(0, 10);
  const directory = path.dirname(filePath);
  const extension = path.extname(filePath);
  const baseName = path.basename(filePath, extension);

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const suffix = attempt === 0 ? date : `${date}-${attempt + 1}`;
    const candidate = path.join(directory, `${baseName}-${suffix}${extension}`);
    if (!(await pathExists(candidate))) {
      return candidate;
    }
  }

  throw new Error(`Unable to find available artifact filename for ${filePath}`);
}

function resolveOutputFilename(
  filename: string | null | undefined,
  mediaType: string
): string {
  const extension =
    mediaType === "image/jpeg"
      ? ".jpg"
      : mediaType === "image/webp"
        ? ".webp"
        : ".png";
  const raw = filename?.trim() || DEFAULT_FILENAME;
  let base = path.basename(raw.replace(/\\/g, "/"));

  if (!base || base === "." || base === "..") {
    base = DEFAULT_FILENAME;
  }

  if (!path.extname(base)) {
    base = `${base}${extension}`;
  }

  return base;
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/");
}

async function cleanupArtifactPair(
  filePath: string,
  metaPath: string
): Promise<void> {
  await unlink(filePath).catch(() => undefined);
  await unlink(metaPath).catch(() => undefined);
}

function hasOwnKey(input: unknown, key: string): boolean {
  return (
    typeof input === "object" && input !== null && Object.hasOwn(input, key)
  );
}

function readString(input: unknown, key: string): string | null {
  if (typeof input !== "object" || input === null || !(key in input)) {
    return null;
  }

  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function errorMessage(error: unknown): string {
  if (error instanceof NakamaApiError) {
    return error.message;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return String(error);
}
