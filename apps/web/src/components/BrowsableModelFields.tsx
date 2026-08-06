import { useState, type ReactNode } from "react";
import {
  ModelListEditor,
  type ModelListRow,
} from "@/components/ModelListEditor";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";

interface BrowsableModelFieldsProps<T> {
  fieldId: string;
  customModels: ModelListRow[];
  disabled?: boolean;
  density?: "default" | "compact";
  modelsError?: string | null;
  footerHint: ReactNode;
  browseLabel: string;
  showPricing?: boolean;
  showThinkingToggle?: boolean;
  onCustomModelsChange: (models: ModelListRow[]) => void;
  toModelRow: (row: T) => ModelListRow;
  renderBrowse: (onSelect: (row: T) => void) => ReactNode;
}

export function BrowsableModelFields<T>({
  fieldId,
  customModels,
  disabled,
  density = "default",
  modelsError,
  footerHint,
  browseLabel,
  showPricing = true,
  showThinkingToggle = true,
  onCustomModelsChange,
  toModelRow,
  renderBrowse,
}: BrowsableModelFieldsProps<T>) {
  const [isBrowsing, setIsBrowsing] = useState(false);

  const handleBrowseSelect = (row: T) => {
    const nextModel = toModelRow(row);

    if (customModels.some((model) => model.id === nextModel.id)) {
      setIsBrowsing(false);
      return;
    }

    onCustomModelsChange([...customModels, nextModel]);
    setIsBrowsing(false);
  };

  return (
    <FormField
      id={fieldId}
      label="Models"
      density={density}
      footer={
        modelsError ? (
          <p className="text-sm text-destructive" role="alert">
            {modelsError}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">{footerHint}</p>
        )
      }
    >
      {isBrowsing ? (
        <div className="space-y-2">
          {renderBrowse(handleBrowseSelect)}
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
          showPricing={showPricing}
          showThinkingToggle={showThinkingToggle}
          browseLabel={browseLabel}
          onBrowse={() => setIsBrowsing(true)}
          onChange={onCustomModelsChange}
        />
      )}
    </FormField>
  );
}
