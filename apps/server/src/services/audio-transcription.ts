import { NakamaApiError, type UserConfig } from "@nakama/core";
import { modelSupportsTranscription } from "../providers/models";
import {
  type ResolvedProfileProviderSelection,
  resolveConfiguredModelInstance,
} from "./provider-instance-helpers";

export const TRANSCRIPTION_MODEL_REQUIRED_MESSAGE =
  "Configure an audio transcription model in Settings before sending voice messages.";

export function resolveTranscriptionProviderSelection(
  userConfig: UserConfig | null | undefined
): ResolvedProfileProviderSelection | null {
  const configured = resolveConfiguredModelInstance(
    userConfig,
    userConfig?.transcriptionModel,
    {
      invalid:
        "Configured audio transcription model is invalid. Update it in Settings.",
      missingProvider:
        "Configured audio transcription provider is missing. Update it in Settings.",
    }
  );

  if (!configured) {
    return null;
  }

  // Self-hosted backends speaking the OpenAI-compatible transcriptions API
  // surface as `openai_compatible` with a baseUrl (e.g. local Whisper),
  // alongside first-party `openai`. Other types are not supported.
  if (
    !(
      configured.instance.type === "openai" ||
      (configured.instance.type === "openai_compatible" &&
        configured.instance.baseUrl?.trim())
    )
  ) {
    throw new NakamaApiError(
      "Audio transcription requires an OpenAI or OpenAI-compatible provider with a base URL. Update it in Settings.",
      400
    );
  }

  if (
    !modelSupportsTranscription(configured.modelId, configured.instance.type)
  ) {
    throw new NakamaApiError(
      `Configured audio transcription model "${configured.modelId}" is not supported.`,
      400
    );
  }

  return {
    instance: configured.instance,
    model: configured.modelId,
  };
}
