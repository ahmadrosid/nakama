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

  if (configured.instance.type !== "openai") {
    throw new NakamaApiError(
      "Audio transcription requires an OpenAI provider. Update it in Settings.",
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
