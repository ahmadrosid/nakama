import { BrowsableModelFields } from "@/components/BrowsableModelFields";
import type { ModelListRow } from "@/components/ModelListEditor";
import { OpenRouterModelsBrowseList } from "@/components/OpenRouterModelsBrowseList";
import type { OpenRouterModelRow } from "@/lib/openrouter-models";

interface OpenRouterProviderModelFieldsProps {
  customModels: ModelListRow[];
  density?: "default" | "compact";
  disabled?: boolean;
  modelsError?: string | null;
  onCustomModelsChange: (models: ModelListRow[]) => void;
}

export function OpenRouterProviderModelFields({
  customModels,
  disabled,
  density = "default",
  modelsError,
  onCustomModelsChange,
}: OpenRouterProviderModelFieldsProps) {
  return (
    <BrowsableModelFields
      browseLabel="Browse OpenRouter"
      customModels={customModels}
      density={density}
      disabled={disabled}
      fieldId="openrouter-provider-models"
      modelsError={modelsError}
      onCustomModelsChange={onCustomModelsChange}
      renderBrowse={(onSelect) => (
        <OpenRouterModelsBrowseList
          className="h-72 rounded-md border border-border"
          onSelect={onSelect}
        />
      )}
      showThinking
      showVision
      toModelRow={(row: OpenRouterModelRow) => ({
        id: row.id,
        name: row.name,
        supportsThinking: row.reasoning,
        supportsVision: row.vision,
        ...(row.inputPerMillionUsd === undefined
          ? {}
          : { inputPerMillionUsd: row.inputPerMillionUsd }),
        ...(row.outputPerMillionUsd === undefined
          ? {}
          : { outputPerMillionUsd: row.outputPerMillionUsd }),
      })}
    />
  );
}
