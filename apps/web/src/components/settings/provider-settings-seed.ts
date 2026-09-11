import type {
  CustomModelEntry,
  ProviderModelOption,
} from "@nakama/core/contract";
import type { ModelListRow } from "@/components/ModelListEditor";

export function seedManageModelRows(
  customModels: CustomModelEntry[] | undefined,
  configuredModels: ProviderModelOption[]
): ModelListRow[] {
  const models = customModels?.length ? customModels : configuredModels;
  return models.map((model) => ({
    default: model.default,
    id: model.id,
    inputPerMillionUsd: model.inputPerMillionUsd,
    name: model.name ?? model.id,
    outputPerMillionUsd: model.outputPerMillionUsd,
    supportsThinking: model.supportsThinking,
    supportsVision: model.supportsVision,
  }));
}
