import { useState } from "react";
import {
  ModelListEditor,
  type ModelListRow,
} from "@/components/ModelListEditor";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import type { CerebrasModelRow } from "@/lib/cerebras-models";
import { CerebrasModelsBrowseList } from "@/components/CerebrasModelsBrowseList";

interface CerebrasProviderModelFieldsProps {
  customModels: ModelListRow[];
  disabled?: boolean;
  density?: "default" | "compact";
  modelsError?: string | null;
  onCustomModelsChange: (models: ModelListRow[]) => void;
  onBrowseModelAdded?: (row: CerebrasModelRow) => void;
}

export function CerebrasProviderModelFields({
  customModels,
  disabled,
  density = "default",
  modelsError,
  onCustomModelsChange,
  onBrowseModelAdded,
}: CerebrasProviderModelFieldsProps) {
  const [isBrowsing, setIsBrowsing] = useState(false);

  const handleBrowseSelect = (row: CerebrasModelRow) => {
    const nextModel: ModelListRow = {
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
    };

    if (customModels.some((model) => model.id === nextModel.id)) {
      setIsBrowsing(false);
      return;
    }

    onCustomModelsChange([...customModels, nextModel]);
    onBrowseModelAdded?.(row);
    setIsBrowsing(false);
  };

  return (
    <FormField
      id="cerebras-provider-models"
      label="Models"
      density={density}
      footer={
        modelsError ? (
          <p className="text-sm text-destructive" role="alert">
            {modelsError}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Add models by ID or browse Cerebras. Reasoning-capable models enable thinking by
            default. Pricing from browse is saved for usage cost on the Status page.
          </p>
        )
      }
    >
      {isBrowsing ? (
        <div className="space-y-2">
          <CerebrasModelsBrowseList
            onSelect={handleBrowseSelect}
            className="h-72 rounded-md border border-border"
          />
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => setIsBrowsing(false)}
            >
              Back
            </Button>
          </div>
        </div>
      ) : (
        <ModelListEditor
          models={customModels}
          disabled={disabled}
          showPricing
          showThinkingToggle
          browseLabel="Browse Cerebras"
          onBrowse={() => setIsBrowsing(true)}
          onChange={onCustomModelsChange}
        />
      )}
    </FormField>
  );
}
