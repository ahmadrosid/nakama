import type {
  CustomModelEntry,
  ProviderModelOption,
} from "@nakama/core/contract";
import type { ModelListRow } from "@/components/ModelListEditor";

export function seedManageModelRows(
  customModels: CustomModelEntry[] | undefined,
  configuredModels: ProviderModelOption[]
): ModelListRow[] {
  if (customModels?.length) {
    return customModels.map((model) => ({
      default: model.default,
      id: model.id,
      inputPerMillionUsd: model.inputPerMillionUsd,
      name: model.name ?? model.id,
      outputPerMillionUsd: model.outputPerMillionUsd,
      supportsThinking: model.supportsThinking,
    }));
  }

  return configuredModels.map((model) => ({
    default: model.default,
    id: model.id,
    inputPerMillionUsd: model.inputPerMillionUsd,
    name: model.name ?? model.id,
    outputPerMillionUsd: model.outputPerMillionUsd,
    supportsThinking: model.supportsThinking,
  }));
}

/** Seeds OpenRouter / Cerebras (and similar) manage dialogs. */
export function seedShortlistManageModelRows(
  customModels: CustomModelEntry[] | undefined,
  currentModel?: string | null,
  currentModelName?: string | null
): ModelListRow[] {
  if (customModels?.length) {
    return customModels.map((model) => ({
      default: model.default,
      id: model.id,
      inputPerMillionUsd: model.inputPerMillionUsd,
      name: model.name ?? model.id,
      outputPerMillionUsd: model.outputPerMillionUsd,
      supportsThinking: model.supportsThinking,
      supportsVision: model.supportsVision,
    }));
  }

  const trimmed = currentModel?.trim();
  if (trimmed) {
    return [
      {
        default: true,
        id: trimmed,
        name: currentModelName?.trim() || trimmed,
      },
    ];
  }

  return [{ id: "", name: "" }];
}
