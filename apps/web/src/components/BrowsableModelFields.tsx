import { type ReactNode, useState } from "react";
import {
  ModelListEditor,
  type ModelListRow,
} from "@/components/ModelListEditor";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";

interface BrowsableModelFieldsProps<T> {
  browseLabel: string;
  customModels: ModelListRow[];
  density?: "default" | "compact";
  disabled?: boolean;
  fieldId: string;
  footerHint: ReactNode;
  modelsError?: string | null;
  onCustomModelsChange: (models: ModelListRow[]) => void;
  renderBrowse: (onSelect: (row: T) => void) => ReactNode;
  showPricing?: boolean;
  toModelRow: (row: T) => ModelListRow;
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
      density={density}
      footer={
        modelsError ? (
          <p className="text-destructive text-sm" role="alert">
            {modelsError}
          </p>
        ) : (
          <p className="text-muted-foreground text-xs">{footerHint}</p>
        )
      }
      id={fieldId}
      label="Models"
    >
      {isBrowsing ? (
        <div className="space-y-2">
          {renderBrowse(handleBrowseSelect)}
          <div className="flex justify-end">
            <Button
              disabled={disabled}
              onClick={() => setIsBrowsing(false)}
              size="sm"
              type="button"
              variant="outline"
            >
              Back
            </Button>
          </div>
        </div>
      ) : (
        <ModelListEditor
          browseLabel={browseLabel}
          disabled={disabled}
          models={customModels}
          onBrowse={() => setIsBrowsing(true)}
          onChange={onCustomModelsChange}
          showPricing={showPricing}
        />
      )}
    </FormField>
  );
}
