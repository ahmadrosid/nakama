import { Button } from "@nakama/ui/button";
import { FormField } from "@nakama/ui/form-field";
import { Add01Icon } from "hugeicons-react";
import { type ReactNode, useState } from "react";
import {
  ModelListEditor,
  type ModelListRow,
} from "@/components/ModelListEditor";

interface BrowsableModelFieldsProps<T> {
  browseLabel: string;
  customModels: ModelListRow[];
  density?: "default" | "compact";
  disabled?: boolean;
  fieldId: string;
  footerHint?: ReactNode;
  modelsError?: string | null;
  onCustomModelsChange: (models: ModelListRow[]) => void;
  renderBrowse: (context: {
    multiSelect: boolean;
    onAddMany: (rows: T[]) => void;
    onSelect: (row: T) => void;
  }) => ReactNode;
  showPricing?: boolean;
  showThinking?: boolean;
  showVision?: boolean;
  toModelRow: (row: T) => ModelListRow;
  visionDefaultOn?: boolean;
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
  showThinking = false,
  showVision = false,
  visionDefaultOn = false,
  onCustomModelsChange,
  toModelRow,
  renderBrowse,
}: BrowsableModelFieldsProps<T>) {
  const [isBrowsing, setIsBrowsing] = useState(false);
  const showBrowse = isBrowsing || customModels.length === 0;

  const handleBrowseSelect = (row: T) => {
    const nextModel = toModelRow(row);

    if (customModels.some((model) => model.id === nextModel.id)) {
      setIsBrowsing(false);
      return;
    }

    onCustomModelsChange([...customModels, nextModel]);
    setIsBrowsing(false);
  };

  const handleAddMany = (rows: T[]) => {
    const existingIds = new Set(customModels.map((model) => model.id));
    const nextModels: ModelListRow[] = [];
    for (const row of rows) {
      const model = toModelRow(row);
      if (existingIds.has(model.id)) {
        continue;
      }

      existingIds.add(model.id);
      nextModels.push(model);
    }

    if (nextModels.length > 0) {
      onCustomModelsChange([...customModels, ...nextModels]);
    }
  };

  return (
    <FormField
      density={density}
      footer={
        modelsError ? (
          <p className="text-destructive text-sm" role="alert">
            {modelsError}
          </p>
        ) : footerHint ? (
          <p className="text-muted-foreground text-xs">{footerHint}</p>
        ) : undefined
      }
      id={fieldId}
      label="Models"
    >
      {showBrowse ? (
        <div className="space-y-2">
          {renderBrowse({
            multiSelect: true,
            onAddMany: handleAddMany,
            onSelect: handleBrowseSelect,
          })}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              disabled={disabled}
              onClick={() => {
                onCustomModelsChange([...customModels, { id: "", name: "" }]);
                setIsBrowsing(false);
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              <Add01Icon className="mr-1 size-4" />
              Add model
            </Button>
            {customModels.length > 0 ? (
              <Button
                disabled={disabled}
                onClick={() => setIsBrowsing(false)}
                size="sm"
                type="button"
                variant="outline"
              >
                Back
              </Button>
            ) : null}
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
          showThinking={showThinking}
          showVision={showVision}
          visionDefaultOn={visionDefaultOn}
        />
      )}
    </FormField>
  );
}
