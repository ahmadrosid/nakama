import type { CustomModelEntry, ProviderModelOption } from "@nakama/core/contract";
import type { ModelListRow } from "@/components/ModelListEditor";

export function seedManageModelRows(
  customModels: CustomModelEntry[] | undefined,
  configuredModels: ProviderModelOption[],
): ModelListRow[] {
  if (customModels?.length) {
    return customModels.map((model) => ({
      id: model.id,
      name: model.name ?? model.id,
      default: model.default,
      supportsThinking: model.supportsThinking,
      inputPerMillionUsd: model.inputPerMillionUsd,
      outputPerMillionUsd: model.outputPerMillionUsd,
    }));
  }

  return configuredModels.map((model) => ({
    id: model.id,
    name: model.name ?? model.id,
    default: model.default,
    supportsThinking: model.supportsThinking,
    inputPerMillionUsd: model.inputPerMillionUsd,
    outputPerMillionUsd: model.outputPerMillionUsd,
  }));
}

/** Seeds OpenRouter / Cerebras (and similar) manage dialogs. */
export function seedShortlistManageModelRows(
  customModels: CustomModelEntry[] | undefined,
  currentModel?: string | null,
  currentModelName?: string | null,
): ModelListRow[] {
  if (customModels?.length) {
    return customModels.map((model) => ({
      id: model.id,
      name: model.name ?? model.id,
      default: model.default,
      supportsThinking: model.supportsThinking,
      supportsVision: model.supportsVision,
      inputPerMillionUsd: model.inputPerMillionUsd,
      outputPerMillionUsd: model.outputPerMillionUsd,
    }));
  }

  const trimmed = currentModel?.trim();
  if (trimmed) {
    return [
      {
        id: trimmed,
        name: currentModelName?.trim() || trimmed,
        default: true,
      },
    ];
  }

  return [{ id: "", name: "" }];
}
