import {
  type ChatgptOAuthCredentials,
  chatgptOAuthNeedsRefresh,
  isChatgptProviderConnected,
  NakamaApiError,
  type ProviderInstance,
  readChatgptOAuthFromInstance,
  type UserConfig,
} from "@nakama/core";
import {
  CHATGPT_CODEX_BASE_URL,
  refreshChatgptOAuthToken,
} from "../providers/chatgpt/oauth";
import { getDefaultModel } from "../providers/models";
import { buildProviderHttpError } from "../providers/shared";
import {
  decodeImageBase64,
  type GenerateImageInput,
  type GenerateImageResult,
  imageGenerationDeadline,
  imageMediaType,
  normalizeImageGenerationSize,
  type ResolvedImageGenerationSelection,
  readNumber,
  readRecord,
  readString,
  resolveImageGenerationTokens,
} from "./image-generation";

export function resolveChatgptImageGenerationSelection(
  instance: ProviderInstance,
  modelId: string,
  selection: string
): ResolvedImageGenerationSelection {
  const oauth = isChatgptProviderConnected(instance)
    ? readChatgptOAuthFromInstance(instance)
    : null;

  const model = modelId.trim();

  if (!(oauth && model)) {
    throw new NakamaApiError(
      `ChatGPT provider "${instance.label}" is not connected. Reconnect in Settings → AI Providers (/settings/providers).`,
      400
    );
  }

  return {
    apiKey: oauth.accessToken,
    baseUrl: CHATGPT_CODEX_BASE_URL,
    chatgptOAuth: oauth,
    instance,
    model,
    selection,
  };
}

/**
 * No image model saved: a connected ChatGPT subscription makes images, so a
 * ChatGPT user does not need an admin to pick a model first. The default
 * provider wins when it is a ChatGPT one.
 */
export function resolveDefaultChatgptImageGenerationSelection(
  userConfig: UserConfig | null | undefined
): ResolvedImageGenerationSelection | null {
  const connected = (userConfig?.providers ?? []).filter(
    isChatgptProviderConnected
  );

  const instance =
    connected.find(
      (provider) => provider.id === userConfig?.defaultProviderId
    ) ?? connected[0];

  if (!instance) {
    return null;
  }

  const model = getDefaultModel("chatgpt", instance.customModels);

  return resolveChatgptImageGenerationSelection(
    instance,
    model,
    `${instance.id}::${model}`
  );
}

const CHATGPT_IMAGE_INSTRUCTIONS =
  "Generate the image the user describes. Call the image_generation tool once.";

/**
 * Peak memory: the whole SSE body (~2 MB of base64 for one image) is held
 * before decode, so a call peaks near 2x the image as text.
 */
export async function generateImageWithChatgpt(
  input: GenerateImageInput,
  chatgpt: NonNullable<GenerateImageInput["chatgpt"]>,
  prompt: string
): Promise<GenerateImageResult> {
  const model = input.model?.trim();

  if (!model) {
    throw new NakamaApiError("Image generation model is required.", 400);
  }

  const size = normalizeImageGenerationSize(input.size);

  const { rethrowTimeout, signal } = imageGenerationDeadline(input.signal);

  // A stop or the deadline ends the wait. The shared redeem keeps running for
  // the other calls that wait on it.
  const stopped = new Promise<never>((_resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
    }

    signal.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
  });

  stopped.catch(() => undefined);

  const refresh = async (refreshToken: string) => {
    const redeem = refreshChatgptOAuthToken(refreshToken);
    redeem.catch(() => undefined);
    let next: ChatgptOAuthCredentials;

    try {
      next = await Promise.race([redeem, stopped]);
    } catch (error) {
      if (signal.aborted) {
        return rethrowTimeout(error);
      }

      if (error instanceof NakamaApiError) {
        throw error;
      }

      throw new NakamaApiError(
        `ChatGPT token refresh failed: ${error instanceof Error ? error.message : String(error)}`,
        502
      );
    }

    // Outside the try: a failed save is not an expired sign-in.
    await chatgpt.onTokenRefresh?.(next);

    return next;
  };

  let oauth = chatgptOAuthNeedsRefresh(chatgpt.oauth)
    ? await refresh(chatgpt.oauth.refreshToken)
    : chatgpt.oauth;

  const requestBody = JSON.stringify({
    input: [{ content: [{ text: prompt, type: "input_text" }], role: "user" }],
    instructions: CHATGPT_IMAGE_INSTRUCTIONS,
    model,
    store: false,
    // Codex rejects non-streaming /responses calls.
    stream: true,
    tool_choice: { type: "image_generation" },
    tools: [{ output_format: "png", size, type: "image_generation" }],
  });

  const postResponses = (credentials: ChatgptOAuthCredentials) =>
    fetch(`${CHATGPT_CODEX_BASE_URL}/responses`, {
      body: requestBody,
      headers: {
        Accept: "text/event-stream",
        Authorization: `Bearer ${credentials.accessToken}`,
        "ChatGPT-Account-ID": credentials.accountId,
        "Content-Type": "application/json",
        "OpenAI-Beta": "responses=v1",
        originator: "nakama",
      },
      method: "POST",
      signal,
    }).catch(rethrowTimeout);

  let response = await postResponses(oauth);

  // The upstream can reject a token before its stored expiry. Refresh once.
  if (response.status === 401) {
    await response.body?.cancel();

    // Another call may have rotated the tokens after this one read them. Its
    // refresh token is then spent, so use the saved tokens instead.
    const latest = chatgpt.getOAuth?.() ?? oauth;

    oauth =
      latest.refreshToken === oauth.refreshToken ||
      chatgptOAuthNeedsRefresh(latest)
        ? await refresh(latest.refreshToken)
        : latest;

    response = await postResponses(oauth);
  }

  if (!response.ok) {
    const body = await response.text().catch(rethrowTimeout);
    throw buildProviderHttpError(
      "ChatGPT image generation",
      response.status,
      body
    );
  }

  const image = parseChatgptImageStream(
    await response.text().catch(rethrowTimeout)
  );

  if (!image.b64) {
    throw new NakamaApiError("Image generation returned no image data.", 502);
  }

  const result: GenerateImageResult = {
    data: decodeImageBase64(image.b64),
    mediaType: imageMediaType(image.outputFormat),
    model,
    // The hosted tool treats size as a hint; report what came back.
    size: image.size ?? size,
    usage: resolveImageGenerationTokens(prompt, size, image.usage),
  };

  if (image.revisedPrompt) {
    result.revisedPrompt = image.revisedPrompt;
  }

  return result;
}

interface ChatgptImageStreamResult {
  b64?: string;
  outputFormat?: string;
  revisedPrompt?: string;
  size?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

function parseChatgptImageStream(text: string): ChatgptImageStreamResult {
  const result: ChatgptImageStreamResult = {};

  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ")) {
      continue;
    }

    let event: Map<string, unknown> | undefined;

    try {
      event = readRecord(JSON.parse(line.slice("data: ".length)));
    } catch {
      continue;
    }

    const type = readString(event?.get("type"));

    if (type === "error" || type === "response.failed") {
      const response = readRecord(event?.get("response"));
      const error = readRecord(event?.get("error") ?? response?.get("error"));

      const message =
        readString(error?.get("message")) ?? readString(event?.get("message"));

      throw new NakamaApiError(
        `Image generation failed: ${message ?? "the provider returned an error."}`,
        502
      );
    }

    if (type === "response.output_item.done") {
      const item = readRecord(event?.get("item"));

      if (readString(item?.get("type")) === "image_generation_call") {
        result.b64 = readString(item?.get("result"))?.trim() || undefined;
        result.outputFormat = readString(item?.get("output_format"));
        result.revisedPrompt =
          readString(item?.get("revised_prompt"))?.trim() || undefined;
        result.size = readString(item?.get("size"));
      }
    }

    if (type === "response.completed") {
      const response = readRecord(event?.get("response"));
      const toolUsage = readRecord(response?.get("tool_usage"));
      const imageUsage = readRecord(toolUsage?.get("image_gen"));

      if (imageUsage) {
        result.usage = {
          input_tokens: readNumber(imageUsage.get("input_tokens")),
          output_tokens: readNumber(imageUsage.get("output_tokens")),
        };
      }
    }
  }

  return result;
}
