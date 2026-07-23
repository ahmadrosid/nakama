import { BrowsableModelFields } from "@/components/BrowsableModelFields";
import type { ModelListRow } from "@/components/ModelListEditor";
import { CerebrasModelsBrowseList } from "@/components/CerebrasModelsBrowseList";
import type { CerebrasModelRow } from "@/lib/cerebras-models";

interface CerebrasProviderModelFieldsProps {
  customModels: ModelListRow[];
  disabled?: boolean;
  density?: "default" | "compact";
  modelsError?: string | null;
  onCustomModelsChange: (models: ModelListRow[]) => void;
}

export function CerebrasProviderModelFields({
  customModels,
  disabled,
  density = "default",
  modelsError,
  onCustomModelsChange,
}: CerebrasProviderModelFieldsProps) {
  return (
    <BrowsableModelFields
      fieldId="cerebras-provider-models"
      customModels={customModels}
      disabled={disabled}
      density={density}
      modelsError={modelsError}
      browseLabel="Browse Cerebras"
      footerHint="Add models by ID or browse Cerebras. Reasoning-capable models enable thinking by default. Pricing from browse is saved for usage cost on the Status page."
      onCustomModelsChange={onCustomModelsChange}
      toModelRow={(row: CerebrasModelRow) => ({
        id: row.id,
        name: row.name,
        supportsThinking: row.reasoning,
        supportsVision: row.vision,
        ...(row.inputPerMillionUsd !== undefined
          ? { inputPerMillionUsd: row.inputPerMillionUsd }
          : {}),
        ...(row.outputPerMillionUsd !== undefined
          ? { outputPerMillionUsd: row.outputPerMillionUsd }
          : {}),
      })}
      renderBrowse={(onSelect) => (
        <CerebrasModelsBrowseList
          onSelect={onSelect}
          className="h-72 rounded-md border border-border"
        />
      )}
    />
  );
}
