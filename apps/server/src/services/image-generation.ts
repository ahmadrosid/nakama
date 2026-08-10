import {
  findProviderInstance,
  NakamaApiError,
  type ProviderInstance,
  type UserConfig,
} from "@nakama/core";
import { readApiKeyForInstance } from "../providers/create";
import {
  IMAGE_GENERATION_MODEL_ID,
  IMAGE_GENERATION_SELECTION,
  isAllowedImageGenerationSelection,
  modelSupportsImageGeneration,
} from "../providers/models";

export const IMAGE_MODEL_REQUIRED_MESSAGE =
  "Configure an image generation model in Settings before generating images.";

export const IMAGE_GENERATION_SIZES = [
  "1024x1024",
  "1024x1536",
  "1536x1024",
  "auto",
] as const;

export type ImageGenerationSize = (typeof IMAGE_GENERATION_SIZES)[number];

export const DEFAULT_IMAGE_GENERATION_SIZE: ImageGenerationSize = "1024x1024";

const OPENAI_IMAGES_GENERATIONS_URL =
  "https://api.openai.com/v1/images/generations";

export interface ResolvedImageGenerationSelection {
  apiKey: string;
  instance: ProviderInstance;
  model: typeof IMAGE_GENERATION_MODEL_ID;
  selection: typeof IMAGE_GENERATION_SELECTION;
}

export interface ImageGenerationUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface GenerateImageResult {
  data: Uint8Array;
  mediaType: string;
  model: string;
  revisedPrompt?: string;
  size: string;
  usage?: ImageGenerationUsage;
}

export interface GenerateImageInput {
  apiKey: string;
  model?: string;
  prompt: string;
  size?: string;
}

/**
 * Fallback token estimate when the Images API omits `usage`.
 * Input ≈ prompt chars/4; output is a low-quality floor for the chosen size
 * so estimated cost is still non-zero with catalog pricing.
 */
export function fallbackImageGenerationTokens(
  prompt: string,
  size: string
): ImageGenerationUsage {
  const inputTokens = Math.max(1, Math.ceil(prompt.trim().length / 4));
  const outputTokens = size === "1024x1536" || size === "1536x1024" ? 167 : 200;
  return { inputTokens, outputTokens };
}

export function resolveImageGenerationTokens(
  prompt: string,
  size: string,
  usage: { input_tokens?: number; output_tokens?: number } | undefined
): ImageGenerationUsage {
  if (
    usage &&
    typeof usage.input_tokens === "number" &&
    typeof usage.output_tokens === "number" &&
    Number.isFinite(usage.input_tokens) &&
    Number.isFinite(usage.output_tokens) &&
    usage.input_tokens >= 0 &&
    usage.output_tokens >= 0
  ) {
    return {
      inputTokens: Math.floor(usage.input_tokens),
      outputTokens: Math.floor(usage.output_tokens),
    };
  }

  return fallbackImageGenerationTokens(prompt, size);
}

export function normalizeImageGenerationSize(
  size: string | null | undefined
): ImageGenerationSize {
  const trimmed = size?.trim();
  if (!trimmed) {
    return DEFAULT_IMAGE_GENERATION_SIZE;
  }

  if ((IMAGE_GENERATION_SIZES as readonly string[]).includes(trimmed)) {
    return trimmed as ImageGenerationSize;
  }

  throw new NakamaApiError(
    `Unsupported image size "${trimmed}". Allowed: ${IMAGE_GENERATION_SIZES.join(", ")}.`,
    400
  );
}

export function resolveImageGenerationSelection(
  userConfig: UserConfig | null | undefined,
  env: Record<string, string | undefined> = process.env
): ResolvedImageGenerationSelection | null {
  const imageModel = userConfig?.imageModel?.trim();

  if (!imageModel) {
    return null;
  }

  if (!isAllowedImageGenerationSelection(imageModel)) {
    throw new NakamaApiError(
      "Configured image generation model is invalid. Update it in Settings.",
      400
    );
  }

  const openaiInstances = (userConfig?.providers ?? []).filter(
    (provider) => provider.type === "openai"
  );
  const preferredId = userConfig?.defaultProviderId?.trim();
  const preferred =
    preferredId &&
    openaiInstances.some((instance) => instance.id === preferredId)
      ? findProviderInstance(
          { providers: userConfig?.providers ?? [] },
          preferredId
        )
      : null;
  const instance = preferred ?? openaiInstances[0] ?? null;

  if (!instance || instance.type !== "openai") {
    throw new NakamaApiError(
      "Image generation requires an OpenAI provider. Add one in Settings.",
      400
    );
  }

  if (!modelSupportsImageGeneration(IMAGE_GENERATION_MODEL_ID, instance.type)) {
    throw new NakamaApiError(
      `Configured image generation model "${IMAGE_GENERATION_MODEL_ID}" is not supported.`,
      400
    );
  }

  const apiKey = readApiKeyForInstance(instance, env)?.trim();

  if (!apiKey) {
    throw new NakamaApiError(
      "OpenAI API key is missing. Configure an OpenAI provider or set OPENAI_API_KEY.",
      400
    );
  }

  return {
    apiKey,
    instance,
    model: IMAGE_GENERATION_MODEL_ID,
    selection: IMAGE_GENERATION_SELECTION,
  };
}

export async function generateImageWithOpenAI(
  input: GenerateImageInput
): Promise<GenerateImageResult> {
  const prompt = input.prompt?.trim();

  if (!prompt) {
    throw new NakamaApiError("Image prompt is required.", 400);
  }

  const model = (input.model?.trim() || IMAGE_GENERATION_MODEL_ID) as string;

  if (model !== IMAGE_GENERATION_MODEL_ID) {
    throw new NakamaApiError(
      `Image generation model "${model}" is not supported.`,
      400
    );
  }

  const size = normalizeImageGenerationSize(input.size);
  const apiKey = input.apiKey?.trim();

  if (!apiKey) {
    throw new NakamaApiError(
      "OpenAI API key is missing. Configure an OpenAI provider or set OPENAI_API_KEY.",
      400
    );
  }

  const response = await fetch(OPENAI_IMAGES_GENERATIONS_URL, {
    body: JSON.stringify({
      model,
      n: 1,
      // gpt-image models return b64_json; request explicitly for clarity.
      output_format: "png",
      prompt,
      size,
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new NakamaApiError(
      `Image generation failed (${response.status}): ${body}`,
      502
    );
  }

  const payload = (await response.json()) as {
    data?: Array<{ b64_json?: string; revised_prompt?: string }>;
    output_format?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  const first = payload.data?.[0];
  const b64 = first?.b64_json?.trim();

  if (!b64) {
    throw new NakamaApiError("Image generation returned no image data.", 502);
  }

  let bytes: Uint8Array;

  try {
    bytes = Uint8Array.from(Buffer.from(b64, "base64"));
  } catch {
    throw new NakamaApiError(
      "Image generation returned invalid base64 data.",
      502
    );
  }

  if (bytes.length === 0) {
    throw new NakamaApiError(
      "Image generation returned empty image data.",
      502
    );
  }

  const mediaType =
    payload.output_format === "jpeg"
      ? "image/jpeg"
      : payload.output_format === "webp"
        ? "image/webp"
        : "image/png";

  return {
    data: bytes,
    mediaType,
    model,
    size,
    ...(first.revised_prompt?.trim()
      ? { revisedPrompt: first.revised_prompt.trim() }
      : {}),
    usage: resolveImageGenerationTokens(prompt, size, payload.usage),
  };
}
