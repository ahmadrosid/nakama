import {
  IMAGE_VISION_SYSTEM_PROMPT,
  type MessageContentPart,
  NakamaApiError,
  type ProviderClient,
  type UserConfig,
} from "@nakama/core";
import { modelSupportsVision } from "../providers/models";
import {
  type ResolvedProfileProviderSelection,
  resolveConfiguredModelInstance,
  resolveProfileProviderSelection,
} from "./provider-instance-helpers";

export function resolveVisionProviderSelection(
  userConfig: UserConfig | null | undefined
): ResolvedProfileProviderSelection | null {
  if (
    !resolveConfiguredModelInstance(userConfig, userConfig?.visionModel, {
      invalid:
        "Configured image parsing model is invalid. Update it in Settings.",
      missingProvider:
        "Configured image parsing provider is missing. Update it in Settings.",
    })
  ) {
    return null;
  }

  const resolved = resolveProfileProviderSelection({
    defaultProviderId: userConfig?.defaultProviderId,
    profileModel: userConfig?.visionModel,
    providers: userConfig?.providers ?? [],
  });

  if (!resolved) {
    throw new NakamaApiError(
      "Configured image parsing model is unavailable. Update it in Settings.",
      400
    );
  }

  const supportsVision = modelSupportsVision(
    resolved.model,
    resolved.instance.type,
    resolved.instance.customModels
  );

  if (supportsVision !== true) {
    throw new NakamaApiError(
      `Configured image parsing model "${resolved.model}" does not support vision.`,
      400
    );
  }

  return resolved;
}

export function resolvePrimaryModelVisionSupport(
  userConfig: UserConfig | null | undefined,
  profileModel: string | null | undefined
): boolean | undefined {
  const resolved = resolveProfileProviderSelection({
    defaultProviderId: userConfig?.defaultProviderId,
    profileModel,
    providers: userConfig?.providers ?? [],
  });

  if (!resolved) {
    return;
  }

  return modelSupportsVision(
    resolved.model,
    resolved.instance.type,
    resolved.instance.customModels
  );
}

export async function describeImagesWithVisionModel(
  provider: ProviderClient,
  images: Extract<MessageContentPart, { type: "image" }>[]
): Promise<string[]> {
  const descriptions: string[] = [];

  for (const image of images) {
    const result = await provider.generateChat({
      messages: [{ content: [image], role: "user" }],
      system: IMAGE_VISION_SYSTEM_PROMPT,
    });

    descriptions.push(result.content.trim());
  }

  return descriptions;
}

export const VISION_MODEL_REQUIRED_MESSAGE =
  "This model cannot see images. Configure an image parsing model in Settings before sending images.";
