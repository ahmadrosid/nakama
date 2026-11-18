import {
  type ChatgptOAuthCredentials,
  findProviderInstance,
  NakamaApiError,
  normalizeBaseUrl,
  type ProviderInstance,
  readBoundedBody,
  type UserConfig,
} from "@nakama/core";
import { defaultDiscoveryBaseUrl } from "@nakama/core/discovery-providers";
import { isCompatibleModelId } from "../providers/compatible-models";
import { readApiKeyForInstance } from "../providers/create";
import {
  IMAGE_GENERATION_MODEL_ID,
  IMAGE_GENERATION_SELECTION,
  isAllowedImageGenerationSelection,
  isMinimaxImageGenerationModel,
  modelSupportsImageGeneration,
} from "../providers/models";
import {
  generateImageWithChatgpt,
  resolveChatgptImageGenerationSelection,
  resolveDefaultChatgptImageGenerationSelection,
} from "./image-generation-chatgpt";
import { decodeStoredModelSelection } from "./provider-instance-helpers";

const IMAGE_MODEL_REQUIRED_MESSAGE =
  "Configure an image generation model in Settings → AI Providers (/settings/providers#image-generation) before generating images.";

/** Stored image model that turns image generation off. */
const IMAGE_GENERATION_OFF = "off";

const IMAGE_GENERATION_OFF_MESSAGE =
  "Image generation is turned off. A platform admin can turn it on in Settings → AI Providers (/settings/providers#image-generation).";

/** Why no image model resolved: turned off, or none set up. */
export function imageGenerationUnavailableMessage(
  userConfig: UserConfig | null | undefined
): string {
  return userConfig?.imageModel?.trim() === IMAGE_GENERATION_OFF
    ? IMAGE_GENERATION_OFF_MESSAGE
    : IMAGE_MODEL_REQUIRED_MESSAGE;
}

export const IMAGE_GENERATION_SIZES = [
  "1024x1024",
  "1024x1536",
  "1536x1024",
  "auto",
] as const;

export type ImageGenerationSize = (typeof IMAGE_GENERATION_SIZES)[number];

const DEFAULT_IMAGE_GENERATION_SIZE: ImageGenerationSize = "1024x1024";

const OPENAI_IMAGES_GENERATIONS_PATH = "/images/generations";

const DEFAULT_OPENAI_IMAGES_BASE_URL = "https://api.openai.com/v1";

/**
 * Generation usually lands in 25-80s. A provider that trickles its response
 * (one took 11 minutes) must fail with a clear error instead of hanging the turn.
 */
const IMAGE_GENERATION_TIMEOUT_MS = 180_000;

/** One base64 PNG at the largest size is under 10 MB; this stops a runaway endpoint. */
const MAX_IMAGE_RESPONSE_BYTES = 32 * 1024 * 1024;

const MAX_IMAGE_ERROR_BODY_BYTES = 64 * 1024;

export interface ResolvedImageGenerationSelection {
  apiKey: string;
  baseUrl: string;
  /** Set for a ChatGPT subscription provider. */
  chatgptOAuth?: ChatgptOAuthCredentials;
  instance: ProviderInstance;
  model: string;
  selection: string;
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
  /** Override OpenAI Images base URL (e.g. self-hosted compatible backend). Defaults to api.openai.com/v1. */
  baseUrl?: string;
  /**
   * ChatGPT subscription: `model` is a chat model that calls the hosted
   * `image_generation` tool on the Codex Responses backend.
   */
  chatgpt?: {
    /** The saved tokens now, which another call may have rotated. */
    getOAuth?: () => ChatgptOAuthCredentials | null;
    oauth: ChatgptOAuthCredentials;
    onTokenRefresh?: (oauth: ChatgptOAuthCredentials) => Promise<void>;
  };
  model?: string;
  prompt: string;
  /** The turn's cancel signal, so a stopped chat stops the download too. */
  signal?: AbortSignal;
  size?: string;
}

interface OpenAIImageResponse {
  data: Array<{ b64_json?: string; revised_prompt?: string }>;
  output_format?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
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
    usage.input_tokens !== undefined &&
    usage.output_tokens !== undefined &&
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

  const allowedSize = IMAGE_GENERATION_SIZES.find(
    (candidate) => candidate === trimmed
  );

  if (allowedSize) {
    return allowedSize;
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

  if (imageModel === IMAGE_GENERATION_OFF) {
    return null;
  }

  // Unset means "use the ChatGPT subscription when one is connected".
  if (!imageModel) {
    return resolveDefaultChatgptImageGenerationSelection(userConfig);
  }

  if (!isAllowedImageGenerationSelection(imageModel)) {
    return resolveCompatibleImageGenerationSelection(
      userConfig,
      imageModel,
      env
    );
  }

  const prefix = imageModel.slice(0, imageModel.indexOf("::"));

  const openaiInstances = (userConfig?.providers ?? []).filter((provider) => {
    if (provider.type === "openai") {
      return prefix === "openai";
    }

    // Self-hosted backends that speak the OpenAI Images API surface as
    // openai_compatible with a baseUrl (e.g. a local OpenAI-compatible
    // wrapper). They carry an apiKey and must resolve a real baseUrl.
    return (
      prefix === "openai_compatible" &&
      provider.type === "openai_compatible" &&
      Boolean(provider.baseUrl?.trim())
    );
  });

  const preferredId = userConfig?.defaultProviderId?.trim();

  const preferred =
    preferredId &&
    openaiInstances.some((instance) => instance.id === preferredId)
      ? findProviderInstance(userConfig, preferredId)
      : null;

  const instance = preferred ?? openaiInstances[0] ?? null;

  if (!instance) {
    throw new NakamaApiError(
      "Image generation requires an OpenAI provider. Add one in Settings → AI Providers (/settings/providers).",
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

  const baseUrl = normalizeBaseUrl(
    instance.baseUrl?.trim() || DEFAULT_OPENAI_IMAGES_BASE_URL
  );

  return {
    apiKey,
    baseUrl,
    instance,
    model: IMAGE_GENERATION_MODEL_ID,
    selection: IMAGE_GENERATION_SELECTION,
  };
}

/**
 * `<providerId>::<modelId>` on one OpenAI-compatible provider that speaks the
 * OpenAI Images API. The model must be one of that provider's custom models,
 * since gateways often namespace ids (`cb/gpt-image-2`). A MiniMax provider
 * takes only MiniMax image models.
 */
function resolveCompatibleImageGenerationSelection(
  userConfig: UserConfig | null | undefined,
  imageModel: string,
  env: Record<string, string | undefined>
): ResolvedImageGenerationSelection {
  const decoded = decodeStoredModelSelection(imageModel);

  const instance = decoded
    ? findProviderInstance(userConfig, decoded.providerId)
    : null;

  if (decoded && instance?.type === "chatgpt") {
    return resolveChatgptImageGenerationSelection(
      instance,
      decoded.modelId,
      imageModel
    );
  }

  // MiniMax serves its own image models from the region default base URL.
  const minimax =
    instance?.type === "minimax" || instance?.type === "minimax_cn";

  const baseUrl =
    instance?.baseUrl?.trim() ||
    (minimax ? defaultDiscoveryBaseUrl(instance.type) : null);

  const modelSupported =
    decoded &&
    instance &&
    (minimax
      ? modelSupportsImageGeneration(decoded.modelId, instance.type)
      : instance.type === "openai_compatible" &&
        isCompatibleModelId(decoded.modelId, instance.customModels));

  if (!(decoded && instance && baseUrl && modelSupported)) {
    throw new NakamaApiError(
      "Configured image generation model is invalid. Update it in Settings → AI Providers (/settings/providers#image-generation).",
      400
    );
  }

  const apiKey = readApiKeyForInstance(instance, env)?.trim();

  if (!apiKey) {
    throw new NakamaApiError(
      `API key is missing for provider "${instance.label}".`,
      400
    );
  }

  return {
    apiKey,
    baseUrl: normalizeBaseUrl(baseUrl),
    instance,
    model: decoded.modelId.trim(),
    selection: imageModel,
  };
}

export function imageGenerationDeadline(signal: AbortSignal | undefined) {
  const deadline = AbortSignal.timeout(IMAGE_GENERATION_TIMEOUT_MS);

  return {
    rethrowTimeout: (cause: unknown): never => {
      if (deadline.aborted && !signal?.aborted) {
        throw new NakamaApiError(
          `Image generation timed out after ${IMAGE_GENERATION_TIMEOUT_MS / 1000}s waiting for the provider.`,
          504
        );
      }

      throw cause;
    },
    signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
  };
}

export async function generateImageWithOpenAI(
  input: GenerateImageInput
): Promise<GenerateImageResult> {
  const prompt = input.prompt?.trim();

  if (!prompt) {
    throw new NakamaApiError("Image prompt is required.", 400);
  }

  if (input.chatgpt) {
    return generateImageWithChatgpt(input, input.chatgpt, prompt);
  }

  const model = input.model?.trim() || IMAGE_GENERATION_MODEL_ID;

  // api.openai.com serves only the allowlisted model; a custom base URL serves
  // whatever custom model the resolver picked for it.
  if (!input.baseUrl && model !== IMAGE_GENERATION_MODEL_ID) {
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

  const { rethrowTimeout, signal } = imageGenerationDeadline(input.signal);

  const response = await fetch(
    `${normalizeBaseUrl(input.baseUrl ?? DEFAULT_OPENAI_IMAGES_BASE_URL)}${OPENAI_IMAGES_GENERATIONS_PATH}`,
    {
      body: JSON.stringify({
        model,
        n: 1,
        // gpt-image models return b64_json; request explicitly for clarity.
        output_format: "png",
        prompt,
        size,
        // MiniMax sends a URL unless asked for base64, and `auto` alone
        // means a 4K image, over the size limit.
        ...(isMinimaxImageGenerationModel(model) && {
          response_format: "b64_json",
          ...(size === "auto" && { area: "1K" }),
        }),
      }),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      signal,
    }
  ).catch(rethrowTimeout);

  if (!response.ok) {
    const detail = await readBoundedBody(response, MAX_IMAGE_ERROR_BODY_BYTES)
      .then((bytes) => bytes.toString("utf8"))
      .catch(rethrowTimeout);

    throw new NakamaApiError(
      `Image generation failed (${response.status}): ${detail}`,
      502
    );
  }

  const body = await readBoundedBody(response, MAX_IMAGE_RESPONSE_BYTES).catch(
    rethrowTimeout
  );

  const payload = parseOpenAIImageResponse(JSON.parse(body.toString("utf8")));

  const first = payload.data?.[0];
  const b64 = first?.b64_json?.trim();

  if (!b64) {
    throw new NakamaApiError("Image generation returned no image data.", 502);
  }

  const result: GenerateImageResult = {
    data: decodeImageBase64(b64),
    mediaType: imageMediaType(payload.output_format),
    model,
    size,
    usage: resolveImageGenerationTokens(prompt, size, payload.usage),
  };

  const revisedPrompt = first.revised_prompt?.trim();

  if (revisedPrompt) {
    result.revisedPrompt = revisedPrompt;
  }

  return result;
}

export function decodeImageBase64(b64: string): Uint8Array {
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

  return bytes;
}

export function imageMediaType(outputFormat: string | undefined): string {
  if (outputFormat === "jpeg") {
    return "image/jpeg";
  }

  return outputFormat === "webp" ? "image/webp" : "image/png";
}

function parseOpenAIImageResponse<T>(input: T): OpenAIImageResponse {
  const record = readRecord(input);
  const data = record?.get("data");
  const usage = readRecord(record?.get("usage"));

  return {
    data: Array.isArray(data)
      ? data.map((entry) => {
          const item = readRecord(entry);

          return {
            b64_json: readString(item?.get("b64_json")),
            revised_prompt: readString(item?.get("revised_prompt")),
          };
        })
      : [],
    output_format: readString(record?.get("output_format")),
    usage: usage
      ? {
          input_tokens: readNumber(usage.get("input_tokens")),
          output_tokens: readNumber(usage.get("output_tokens")),
        }
      : undefined,
  };
}

export function readRecord<T>(value: T): Map<string, unknown> | undefined {
  if (!(value instanceof Object)) {
    return;
  }

  return new Map(Object.entries(value));
}

export function readString<T>(value: T): string | undefined {
  // SAFETY: The object tag check confirms the value uses the string representation.
  return Object.prototype.toString.call(value) === "[object String]"
    ? (value as T & string)
    : undefined;
}

export function readNumber<T>(value: T): number | undefined {
  // SAFETY: The tag and finite checks confirm the value is a valid number.
  return Object.prototype.toString.call(value) === "[object Number]" &&
    Number.isFinite(value)
    ? (value as T & number)
    : undefined;
}
