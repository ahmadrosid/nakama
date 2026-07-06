import {
  findProviderInstance,
  IMAGE_VISION_SYSTEM_PROMPT,
  NakamaApiError,
  type MessageContentPart,
  type ProviderClient,
  type UserConfig,
} from "@nakama/core";
import { createProviderForInstance } from "../providers/create";
import { modelSupportsVision } from "../providers/models";
import {
  decodeStoredModelSelection,
  resolveProfileProviderSelection,
  type ResolvedProfileProviderSelection,
} from "./provider-instance-helpers";

export function resolveVisionProviderSelection(
  userConfig: UserConfig | null | undefined,
): ResolvedProfileProviderSelection | null {
  const visionModel = userConfig?.visionModel?.trim();

  if (!visionModel) {
    return null;
  }

  const decoded = decodeStoredModelSelection(visionModel);

  if (!decoded || decoded.providerId === "__unknown__") {
    throw new NakamaApiError(
      "Configured image parsing model is invalid. Update it in Settings.",
      400,
    );
  }

  const instance = findProviderInstance(
    { providers: userConfig?.providers ?? [] },
    decoded.providerId,
  );

  if (!instance) {
    throw new NakamaApiError(
      "Configured image parsing provider is missing. Update it in Settings.",
      400,
    );
  }

  const resolved = resolveProfileProviderSelection({
    providers: userConfig?.providers ?? [],
    defaultProviderId: userConfig?.defaultProviderId,
    profileModel: visionModel,
  });

  if (!resolved) {
    throw new NakamaApiError(
      "Configured image parsing model is unavailable. Update it in Settings.",
      400,
    );
  }

  const supportsVision = modelSupportsVision(
    resolved.model,
    resolved.instance.type,
    resolved.instance.customModels,
  );

  if (supportsVision !== true) {
    throw new NakamaApiError(
      `Configured image parsing model "${resolved.model}" does not support vision.`,
      400,
    );
  }

  return resolved;
}

export function resolvePrimaryModelVisionSupport(
  userConfig: UserConfig | null | undefined,
  profileModel: string | null | undefined,
): boolean | undefined {
  const resolved = resolveProfileProviderSelection({
    providers: userConfig?.providers ?? [],
    defaultProviderId: userConfig?.defaultProviderId,
    profileModel,
  });

  if (!resolved) {
    return undefined;
  }

  return modelSupportsVision(
    resolved.model,
    resolved.instance.type,
    resolved.instance.customModels,
  );
}

export function createVisionFallbackProvider(
  selection: ResolvedProfileProviderSelection,
): ProviderClient {
  return createProviderForInstance(selection.instance, selection.model);
}

export async function describeImagesWithVisionModel(
  provider: ProviderClient,
  images: Extract<MessageContentPart, { type: "image" }>[],
): Promise<string[]> {
  const descriptions: string[] = [];

  for (const image of images) {
    const result = await provider.generateChat({
      system: IMAGE_VISION_SYSTEM_PROMPT,
      messages: [{ role: "user", content: [image] }],
    });

    descriptions.push(result.content.trim());
  }

  return descriptions;
}

export const VISION_MODEL_REQUIRED_MESSAGE =
  "This model cannot see images. Configure an image parsing model in Settings before sending images.";
