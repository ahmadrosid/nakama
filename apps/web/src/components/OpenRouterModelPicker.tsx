import { useMemo, useState } from "react";
import type { ProviderModelOption } from "@nakama/core/contract";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import {
  OpenRouterModelsBrowseList,
  type OpenRouterBrowseSelectHandler,
} from "@/components/OpenRouterModelsBrowseList";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupInput,
} from "@/components/ui/input-group";
import { FormField } from "@/components/ui/form-field";
import { useOpenRouterModels } from "@/hooks/use-openrouter-models";
import {
  openRouterModelDisplayName,
  type OpenRouterModelRow,
} from "@/lib/openrouter-models";
import { resolveModelForProvider } from "@/lib/models";

interface OpenRouterModelPickerProps {
  idPrefix?: string;
  catalogModels: ProviderModelOption[];
  selectedModel: string;
  customModel: string;
  customModelError: string | null;
  disabled?: boolean;
  density?: "default" | "compact";
  onSelectedModelChange: (modelId: string) => void;
  onCustomModelChange: (value: string) => void;
  onBrowseSelect?: (row: OpenRouterModelRow) => void;
}

export function OpenRouterModelPicker({
  idPrefix = "openrouter",
  catalogModels,
  selectedModel,
  customModel,
  customModelError,
  disabled = false,
  density = "default",
  onSelectedModelChange,
  onCustomModelChange,
  onBrowseSelect,
}: OpenRouterModelPickerProps) {
  const [isBrowsing, setIsBrowsing] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const { data: openRouterRows = [] } = useOpenRouterModels();

  const effectiveModelId = useMemo(
    () =>
      resolveModelForProvider("openrouter", selectedModel, customModel) || selectedModel,
    [selectedModel, customModel],
  );

  const effectiveDisplayName = useMemo(() => {
    const fromCatalog = catalogModels.find((model) => model.id === effectiveModelId)?.name;
    if (fromCatalog) {
      return fromCatalog;
    }
    return openRouterModelDisplayName(openRouterRows, effectiveModelId) ?? effectiveModelId;
  }, [catalogModels, effectiveModelId, openRouterRows]);

  const handleBrowseSelect: OpenRouterBrowseSelectHandler = (row) => {
    onCustomModelChange(row.id);
    if (catalogModels.some((model) => model.id === row.id)) {
      onSelectedModelChange(row.id);
    }
    onBrowseSelect?.(row);
    setIsBrowsing(false);
  };

  if (isBrowsing) {
    return (
      <div className="space-y-2">
        <OpenRouterModelsBrowseList
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
    );
  }

  return (
    <div className={density === "compact" ? "space-y-3" : "space-y-4"}>
      {effectiveModelId ? (
        <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
          <p className="text-sm font-medium text-foreground">{effectiveDisplayName}</p>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground">{effectiveModelId}</p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No model selected</p>
      )}

      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => setIsBrowsing(true)}
      >
        Browse OpenRouter models…
      </Button>

      <div>
        <button
          type="button"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setShowAdvanced((current) => !current)}
        >
          {showAdvanced ? (
            <ChevronDownIcon className="size-3.5" />
          ) : (
            <ChevronRightIcon className="size-3.5" />
          )}
          Advanced: type model ID
        </button>
        {showAdvanced ? (
          <FormField
            id={`${idPrefix}-custom-model`}
            label="Model ID"
            density={density}
            className="mt-2"
            footer={
              customModelError ? (
                <p
                  id={`${idPrefix}-custom-model-error`}
                  className="text-sm text-destructive"
                  role="alert"
                >
                  {customModelError}
                </p>
              ) : (
                <p
                  id={`${idPrefix}-custom-model-hint`}
                  className="text-xs text-muted-foreground"
                >
                  Use vendor/model format from OpenRouter, e.g. anthropic/claude-sonnet-4-6.
                </p>
              )
            }
          >
            <InputGroup>
              <InputGroupInput
                id={`${idPrefix}-custom-model`}
                type="text"
                autoComplete="off"
                placeholder="anthropic/claude-sonnet-4-6"
                value={customModel}
                disabled={disabled}
                aria-invalid={customModelError != null}
                aria-describedby={
                  customModelError
                    ? `${idPrefix}-custom-model-error`
                    : `${idPrefix}-custom-model-hint`
                }
                onChange={(event) => onCustomModelChange(event.target.value)}
              />
            </InputGroup>
          </FormField>
        ) : null}
      </div>
    </div>
  );
}
