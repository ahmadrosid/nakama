import type { ProviderModelOption } from "@nakama/core/contract";
import { isDiscoveryModelProvider } from "@nakama/core/discovery-providers";
import type { ModelListRow } from "@/components/ModelListEditor";
import { normalizeModelListRows } from "@/components/model-list-editor.shared";
import {
  getModelDisplayName,
  isShortlistCapabilityProvider,
  type SelectedProvider,
} from "@/lib/models";

/** The model list Add sends for each provider type, or none. */
export function setupCustomModels({
  catalogRows,
  customModels,
  filteredModels,
  modelToSave,
  openRouterModels,
  selectedProvider,
  shortlistModels,
  subscriptionCount,
}: {
  catalogRows: ModelListRow[] | null;
  customModels: ModelListRow[];
  filteredModels: ProviderModelOption[];
  modelToSave: string;
  openRouterModels: ModelListRow[];
  selectedProvider: SelectedProvider;
  shortlistModels: ModelListRow[];
  subscriptionCount: number;
}) {
  return catalogRows
    ? normalizeModelListRows(catalogRows).map((entry) => ({
        ...entry,
        default: entry.id === modelToSave,
      }))
    : (selectedProvider === "chatgpt" && subscriptionCount) ||
        selectedProvider === "xai_oauth"
      ? filteredModels.map((entry) => ({
          default: entry.id === modelToSave,
          id: entry.id,
          name: entry.name,
          supportsVision: entry.supportsVision !== false,
        }))
      : isDiscoveryModelProvider(selectedProvider) ||
          selectedProvider === "ollama"
        ? normalizeModelListRows(customModels).map((entry) => ({
            ...entry,
            default: entry.id === modelToSave,
          }))
        : selectedProvider === "openrouter"
          ? normalizeModelListRows(openRouterModels)
          : isShortlistCapabilityProvider(selectedProvider)
            ? normalizeModelListRows(shortlistModels)
            : selectedProvider === "opencode_go" && modelToSave
              ? normalizeModelListRows([
                  {
                    default: true,
                    id: modelToSave,
                    name: getModelDisplayName(filteredModels, modelToSave),
                  },
                ])
              : undefined;
}
