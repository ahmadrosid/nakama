import type { CustomModelEntry } from "@nakama/core/contract";
import type { ModelListRow } from "@/components/ModelListEditor";

export function normalizeModelListRows(models: ModelListRow[]): CustomModelEntry[] {
  return models.flatMap((row) => {
    const id = row.id.trim();
    if (id.length === 0) {
      return [];
    }

    return [
      {
        id,
        ...(row.name?.trim() ? { name: row.name.trim() } : {}),
        ...(row.default ? { default: true } : {}),
        ...(row.supportsThinking !== undefined
          ? { supportsThinking: row.supportsThinking }
          : {}),
        ...(row.inputPerMillionUsd !== undefined
          ? { inputPerMillionUsd: row.inputPerMillionUsd }
          : {}),
        ...(row.outputPerMillionUsd !== undefined
          ? { outputPerMillionUsd: row.outputPerMillionUsd }
          : {}),
      },
    ];
  });
}
