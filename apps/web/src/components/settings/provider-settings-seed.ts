import type {
  CustomModelEntry,
  ProviderModelOption,
} from "@nakama/core/contract";
import type { ModelListRow } from "@/components/ModelListEditor";

export function seedManageModelRows(
  customModels: CustomModelEntry[] | undefined,
  configuredModels: ProviderModelOption[]
): ModelListRow[] {
  const models: CustomModelEntry[] = customModels?.length
    ? customModels
    : configuredModels;
  return models.map((model) => ({
    cachedInputPerMillionUsd: model.cachedInputPerMillionUsd,
    contextWindow: model.contextWindow,
    default: model.default,
    id: model.id,
    inputPerMillionUsd: model.inputPerMillionUsd,
    maxOutputTokens: model.maxOutputTokens,
    name: model.name ?? model.id,
    outputPerMillionUsd: model.outputPerMillionUsd,
    supportsThinking: model.supportsThinking,
    supportsVision: model.supportsVision,
  }));
}
