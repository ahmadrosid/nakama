import type { OllamaHostMode } from "@nakama/core/contract";
import { BrowsableModelFields } from "@/components/BrowsableModelFields";
import type { ModelListRow } from "@/components/ModelListEditor";
import {
  type RemoteModelRow,
  RemoteModelsBrowseList,
} from "@/components/RemoteModelsBrowseList";

interface OllamaProviderModelFieldsProps {
  apiKey: string;
  baseUrl: string;
  customModels: ModelListRow[];
  density?: "default" | "compact";
  disabled?: boolean;
  hostMode: OllamaHostMode;
  modelsError?: string | null;
  onCustomModelsChange: (models: ModelListRow[]) => void;
}

export function OllamaProviderModelFields({
  apiKey,
  baseUrl,
  customModels,
  disabled,
  density = "default",
  hostMode,
  modelsError,
  onCustomModelsChange,
}: OllamaProviderModelFieldsProps) {
  return (
    <BrowsableModelFields
      browseLabel="Browse models"
      customModels={customModels}
      density={density}
      disabled={disabled}
      fieldId="ollama-models"
      modelsError={modelsError}
      onCustomModelsChange={onCustomModelsChange}
      renderBrowse={({
        addedIds,
        addedModels,
        multiSelect,
        onAddMany,
        onSelect,
      }) => (
        <RemoteModelsBrowseList
          addedIds={addedIds}
          addedModels={addedModels}
          apiKey={apiKey}
          baseUrl={baseUrl}
          browseLabel="Ollama"
          className="h-72 rounded-md border border-border"
          hostMode={hostMode}
          multiSelect={multiSelect}
          onAddMany={onAddMany}
          onSelect={onSelect}
          provider="ollama"
        />
      )}
      showPricing={hostMode === "cloud"}
      showThinking
      showVision
      toModelRow={(row: RemoteModelRow) => {
        const model: ModelListRow = { id: row.id, name: row.name };

        if (row.supportsVision !== undefined) {
          model.supportsVision = row.supportsVision;
        }

        return model;
      }}
    />
  );
}
