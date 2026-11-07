import type { ProviderModelOption } from "@nakama/core/contract";
import { useCallback, useMemo, useState } from "react";
import { isCatalogShortlistProvider } from "@/components/catalog-provider-model-fields.shared";
import type { ModelListRow } from "@/components/ModelListEditor";
import type { SelectedProvider } from "@/lib/models";

// Catalog providers pick from a model list, as Manage does. Sign-in plans
// and OpenCode Go keep their own model step.
function usesCatalogModelList(provider: SelectedProvider): boolean {
  return (
    isCatalogShortlistProvider(provider) &&
    provider !== "chatgpt" &&
    provider !== "xai_oauth" &&
    provider !== "opencode_go"
  );
}

/** The model list Add shows for a catalog provider. */
export function useCatalogModelRows(
  selectedProvider: SelectedProvider,
  filteredModels: ProviderModelOption[],
  setModelsError: (error: string | null) => void
) {
  // Null until the user edits the list; until then the catalog stands.
  const [catalogRows, setCatalogRows] = useState<ModelListRow[] | null>(null);
  const usesCatalogList = usesCatalogModelList(selectedProvider);

  const catalogModelRows = useMemo<ModelListRow[]>(
    () =>
      catalogRows ??
      filteredModels.map((model) => ({
        contextWindow: model.contextWindow,
        default: model.default,
        id: model.id,
        inputPerMillionUsd: model.inputPerMillionUsd,
        name: model.name,
        outputPerMillionUsd: model.outputPerMillionUsd,
        supportsThinking: model.supportsThinking,
        supportsVision: model.supportsVision,
      })),
    [catalogRows, filteredModels]
  );

  const handleCatalogModelsChange = useCallback(
    (rows: ModelListRow[]) => {
      setCatalogRows(rows);
      setModelsError(null);
    },
    [setModelsError]
  );

  return {
    catalogModelRows,
    catalogRows,
    handleCatalogModelsChange,
    setCatalogRows,
    usesCatalogList,
  };
}
