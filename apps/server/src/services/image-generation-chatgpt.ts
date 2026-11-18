import {
  type ChatgptOAuthCredentials,
  chatgptOAuthNeedsRefresh,
  findProviderInstance,
  isChatgptProviderConnected,
  NakamaApiError,
  type ProviderInstance,
  readChatgptOAuthFromInstance,
  type UserConfig,
} from "@nakama/core";
import {
  CHATGPT_CODEX_BASE_URL,
  readChatgptPlanType,
  refreshChatgptOAuthToken,
} from "../providers/chatgpt/oauth";
import { getDefaultModel } from "../providers/models";
import { buildProviderHttpError, readSseEvents } from "../providers/shared";
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

  if (!oauth) {
    throw new NakamaApiError(
      `ChatGPT provider "${instance.label}" is not connected. Reconnect in Settings → AI Providers (/settings/providers).`,
      400
    );
  }

  if (!model) {
    throw new NakamaApiError(
      "Configured image generation model is invalid. Update it in Settings → AI Providers (/settings/providers#image-generation).",
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

const CHATGPT_FREE_IMAGE_MESSAGE =
  "ChatGPT Free accounts can't generate images. Pick another image model in Settings → AI Providers (/settings/providers#image-generation).";

/**
 * No image model saved: a connected ChatGPT subscription makes images, so a
 * ChatGPT user does not need an admin to pick a model first. A paid account
 * wins over a Free one, then the default provider over the others.
 */
export function resolveDefaultChatgptImageGenerationSelection(
  userConfig: UserConfig | null | undefined
): ResolvedImageGenerationSelection | null {
  // Only an instance whose tokens can be read can make the call.
  const connected = (userConfig?.providers ?? []).filter(
    (provider) =>
      isChatgptProviderConnected(provider) &&
      readChatgptOAuthFromInstance(provider) !== null
  );

  // ChatGPT Free has no image tool. The plan can be stale until the token
  // refreshes, so a Free account is still used when it is the only one.
  const paid = connected.filter(
    (provider) =>
      readChatgptPlanType(readChatgptOAuthFromInstance(provider)) !== "free"
  );

  const candidates = paid.length > 0 ? paid : connected;

  const instance =
    candidates.find(
      (provider) => provider.id === userConfig?.defaultProviderId
    ) ?? candidates[0];

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

/**
 * The `chatgpt` input for a ChatGPT selection: it reads the saved tokens at
 * call time, since another call may have rotated them, and saves new ones.
 */
export function chatgptImageInput(
  selection: ResolvedImageGenerationSelection,
  getUserConfig: () => UserConfig | null | undefined,
  saveOAuth: (
    instanceId: string,
    oauth: ChatgptOAuthCredentials
  ) => Promise<void>
): Pick<GenerateImageInput, "chatgpt"> {
  const oauth = selection.chatgptOAuth;

  if (!oauth) {
    return {};
  }

  const instanceId = selection.instance.id;

  return {
    chatgpt: {
      getOAuth: () => {
        const latest = findProviderInstance(getUserConfig(), instanceId);

        return latest ? readChatgptOAuthFromInstance(latest) : null;
      },
      oauth,
      onTokenRefresh: (next) => saveOAuth(instanceId, next),
    },
  };
}

const CHATGPT_IMAGE_INSTRUCTIONS =
  "Generate the image the user describes. Call the image_generation tool once.";

/**
 * Peak memory: the stream is read event by event, but the image event holds
 * the whole base64 image (~2 MB). That text, its parsed copy and the decoded
 * bytes are alive together, so a call peaks near 3x the image as text.
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

    // Codex answers a Free account's image call with a raw 400.
    if (response.status === 400 && readChatgptPlanType(oauth) === "free") {
      throw new NakamaApiError(CHATGPT_FREE_IMAGE_MESSAGE, 400);
    }

    throw buildProviderHttpError(
      "ChatGPT image generation",
      response.status,
      body
    );
  }

  if (!response.body) {
    throw new NakamaApiError("Image generation returned no image data.", 502);
  }

  const image: ChatgptImageStreamResult = {};

  // Read to the end, then throw: a throw inside the callback would leave
  // the stream open.
  await readSseEvents(response.body, ({ data }) => {
    readChatgptImageEvent(data, image);
  }).catch(rethrowTimeout);

  if (image.error !== undefined) {
    throw new NakamaApiError(
      `Image generation failed: ${image.error || "the provider returned an error."}`,
      502
    );
  }

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
  /** Set by an error event; empty when the event had no message. */
  error?: string;
  outputFormat?: string;
  revisedPrompt?: string;
  size?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** Reads one SSE event into `result`, including a provider error event. */
function readChatgptImageEvent(
  data: string,
  result: ChatgptImageStreamResult
): void {
  let event: Map<string, unknown> | undefined;

  try {
    event = readRecord(JSON.parse(data));
  } catch {
    return;
  }

  const type = readString(event?.get("type"));

  if (type === "error" || type === "response.failed") {
    const response = readRecord(event?.get("response"));
    const error = readRecord(event?.get("error") ?? response?.get("error"));

    result.error =
      readString(error?.get("message")) ??
      readString(event?.get("message")) ??
      "";

    return;
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
