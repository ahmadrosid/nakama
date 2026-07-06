import {
  findProviderInstance,
  normalizeBaseUrl,
  NakamaApiError,
  type UserConfig,
} from "@nakama/core";
import { modelSupportsTranscription } from "../providers/models";
import {
  decodeStoredModelSelection,
  type ResolvedProfileProviderSelection,
} from "./provider-instance-helpers";

export const TRANSCRIPTION_MODEL_REQUIRED_MESSAGE =
  "Configure an audio transcription model in Settings before sending voice messages.";

export function resolveTranscriptionProviderSelection(
  userConfig: UserConfig | null | undefined,
): ResolvedProfileProviderSelection | null {
  const transcriptionModel = userConfig?.transcriptionModel?.trim();

  if (!transcriptionModel) {
    return null;
  }

  const decoded = decodeStoredModelSelection(transcriptionModel);

  if (!decoded || decoded.providerId === "__unknown__") {
    throw new NakamaApiError(
      "Configured audio transcription model is invalid. Update it in Settings.",
      400,
    );
  }

  const instance = findProviderInstance(
    { providers: userConfig?.providers ?? [] },
    decoded.providerId,
  );

  if (!instance) {
    throw new NakamaApiError(
      "Configured audio transcription provider is missing. Update it in Settings.",
      400,
    );
  }

  if (instance.type !== "openai") {
    throw new NakamaApiError(
      "Audio transcription requires an OpenAI provider. Update it in Settings.",
      400,
    );
  }

  const modelId = decoded.modelId.trim();

  if (!modelSupportsTranscription(modelId, instance.type)) {
    throw new NakamaApiError(
      `Configured audio transcription model "${modelId}" is not supported.`,
      400,
    );
  }

  return {
    instance,
    model: modelId,
  };
}

export async function transcribeAudioWithOpenAI(
  apiKey: string,
  baseUrl: string | undefined,
  model: string,
  audio: { bytes: Uint8Array; filename: string; mediaType: string },
): Promise<string> {
  const normalizedBase = normalizeBaseUrl(baseUrl ?? "https://api.openai.com/v1");
  const formData = new FormData();
  const blob = new Blob([audio.bytes], { type: audio.mediaType });
  formData.append("file", blob, audio.filename);
  formData.append("model", model);

  const response = await fetch(`${normalizedBase}/audio/transcriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new NakamaApiError(
      `Audio transcription failed (${response.status}): ${body}`,
      502,
    );
  }

  const payload = (await response.json()) as { text?: string };
  const text = payload.text?.trim();

  if (!text) {
    throw new NakamaApiError("Audio transcription returned empty text.", 502);
  }

  return text;
}
