import type { CustomModelEntry } from "@nakama/core/contract";
import type { ModelListRow } from "@/components/ModelListEditor";

export function modelListRowVisionEnabled(
  row: Pick<ModelListRow, "supportsVision">,
  visionDefaultOn: boolean
): boolean {
  if (visionDefaultOn) {
    return row.supportsVision !== false;
  }

  return row.supportsVision === true;
}

export function normalizeModelListRows(
  models: ModelListRow[]
): CustomModelEntry[] {
  return models.flatMap((row) => {
    const id = row.id.trim();

    if (id.length === 0) {
      return [];
    }

    const entry: CustomModelEntry = { id };
    const name = row.name?.trim();

    if (name) {
      entry.name = name;
    }

    if (row.default) {
      entry.default = true;
    }

    if (row.supportsThinking !== undefined) {
      entry.supportsThinking = row.supportsThinking;
    }

    if (row.supportsVision !== undefined) {
      entry.supportsVision = row.supportsVision;
    }

    if (row.cachedInputPerMillionUsd !== undefined) {
      entry.cachedInputPerMillionUsd = row.cachedInputPerMillionUsd;
    }

    if (row.inputPerMillionUsd !== undefined) {
      entry.inputPerMillionUsd = row.inputPerMillionUsd;
    }

    if (row.outputPerMillionUsd !== undefined) {
      entry.outputPerMillionUsd = row.outputPerMillionUsd;
    }

    if (row.contextWindow !== undefined) {
      entry.contextWindow = row.contextWindow;
    }

    if (row.maxOutputTokens !== undefined) {
      entry.maxOutputTokens = row.maxOutputTokens;
    }

    return [entry];
  });
}
