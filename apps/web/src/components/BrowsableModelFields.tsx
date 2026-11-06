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
  /** False until the endpoint can answer (for example, no valid base URL yet). */
  canBrowse?: boolean;
  customModels: ModelListRow[];
  density?: "default" | "compact";
  disabled?: boolean;
  fieldId: string;
  modelsError?: string | null;
  /** Browse pressed before it can work: show what is missing. */
  onBrowseBlocked?: () => void;
  onCustomModelsChange: (models: ModelListRow[]) => void;
  renderBrowse: (context: {
    addedIds: ReadonlySet<string>;
    addedModels: ModelListRow[];
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
  browseLabel,
  canBrowse = true,
  onBrowseBlocked,
  showPricing = true,
  showThinking = false,
  showVision = false,
  visionDefaultOn = false,
  onCustomModelsChange,
  toModelRow,
  renderBrowse,
}: BrowsableModelFieldsProps<T>) {
  const [isBrowsing, setIsBrowsing] = useState(false);
  const [keptModel, setKeptModel] = useState<string | null>(null);
  const showBrowse = canBrowse && (isBrowsing || customModels.length === 0);

  const addedIds = new Set(
    customModels.flatMap((model) => {
      const id = model.id.trim();

      return id ? [id] : [];
    })
  );

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
    // A click on a row that is already in the form takes it out again.
    const [single] = rows;
    setKeptModel(null);

    if (rows.length === 1 && single) {
      const id = toModelRow(single).id;

      const existing = customModels.find((model) => model.id === id);

      if (existing) {
        // A model the user renamed or made default is not dropped by a
        // click; the list opens so they remove it there on purpose.
        if (
          existing.default === true ||
          modelEdited(existing, toModelRow(single))
        ) {
          setKeptModel(existing.name || existing.id);
          setIsBrowsing(false);

          return;
        }

        onCustomModelsChange(customModels.filter((model) => model.id !== id));
        setIsBrowsing(true);

        return;
      }
    }

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

    // Stay in the list so the user can add more.
    setIsBrowsing(true);
  };

  return (
    <FormField
      density={density}
      footer={
        modelsError ? (
          <p className="text-destructive text-sm" role="alert">
            {modelsError}
          </p>
        ) : keptModel && !showBrowse ? (
          <p className="text-muted-foreground text-sm" role="status">
            Kept {keptModel}: you changed it. Remove it with its bin icon.
          </p>
        ) : undefined
      }
      id={fieldId}
      label="Models"
    >
      {showBrowse ? (
        <div className="flex flex-col gap-2">
          {renderBrowse({
            addedIds,
            addedModels: customModels,
            multiSelect: true,
            onAddMany: handleAddMany,
            onSelect: handleBrowseSelect,
          })}
          {/* On a phone the list is long; its actions come first. */}
          <div className="flex flex-wrap items-center justify-between gap-2 max-sm:order-first">
            <Button
              data-models-add=""
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
              Add model by ID
            </Button>
            {customModels.length > 0 ? (
              <Button
                disabled={disabled}
                onClick={() => setIsBrowsing(false)}
                size="sm"
                type="button"
                variant="outline"
              >
                Back to list
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <ModelListEditor
          browse={{
            disabled: !(canBrowse || onBrowseBlocked),
            label: browseLabel,
            onClick: () =>
              canBrowse ? setIsBrowsing(true) : onBrowseBlocked?.(),
          }}
          disabled={disabled}
          models={customModels}
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

const EDITABLE_FIELDS = [
  "name",
  "supportsThinking",
  "supportsVision",
  "inputPerMillionUsd",
  "outputPerMillionUsd",
  "contextWindow",
] as const;

// True when the user changed a field the list row set.
function modelEdited(current: ModelListRow, fromList: ModelListRow): boolean {
  return EDITABLE_FIELDS.some(
    (field) => (current[field] ?? null) !== (fromList[field] ?? null)
  );
}
