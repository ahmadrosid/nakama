import { findCustomModel, type CustomModelEntry } from "@nakama/core";

export function cerebrasModelSupportsThinking(
  model: string,
  customModels?: CustomModelEntry[],
): boolean {
  const trimmed = model.trim();
  const custom = findCustomModel(customModels, trimmed);

  if (custom?.supportsThinking !== undefined) {
    return custom.supportsThinking;
  }

  return false;
}
