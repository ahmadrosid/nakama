import { BrowsableModelFields } from "@/components/BrowsableModelFields";
import type { ModelListRow } from "@/components/ModelListEditor";
import { OpenRouterModelsBrowseList } from "@/components/OpenRouterModelsBrowseList";
import type { OpenRouterModelRow } from "@/lib/openrouter-models";

interface OpenRouterProviderModelFieldsProps {
  customModels: ModelListRow[];
  disabled?: boolean;
  density?: "default" | "compact";
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
      fieldId="openrouter-provider-models"
      customModels={customModels}
      disabled={disabled}
      density={density}
      modelsError={modelsError}
      browseLabel="Browse OpenRouter"
      footerHint="Add models by ID or browse OpenRouter. Pricing from browse is saved for usage cost on the Status page."
      onCustomModelsChange={onCustomModelsChange}
      toModelRow={(row: OpenRouterModelRow) => ({
        id: row.id,
        name: row.name,
        supportsThinking: row.reasoning,
        ...(row.inputPerMillionUsd !== undefined
          ? { inputPerMillionUsd: row.inputPerMillionUsd }
          : {}),
        ...(row.outputPerMillionUsd !== undefined
          ? { outputPerMillionUsd: row.outputPerMillionUsd }
          : {}),
      })}
      renderBrowse={(onSelect) => (
        <OpenRouterModelsBrowseList
          onSelect={onSelect}
          className="h-72 rounded-md border border-border"
        />
      )}
    />
  );
}
