import { useMemo, useState } from "react";
import {
  ModelListEditor,
  type ModelListRow,
} from "@/components/ModelListEditor";
import { OpenCodeGoModelsBrowseList } from "@/components/OpenCodeGoModelsBrowseList";
import type { ProviderModelOption } from "@tinyclaw/core/contract";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { useModelsQuery } from "@/hooks/use-app-queries";
import { filterModelsByProvider } from "@/lib/models";

interface OpenCodeGoProviderModelFieldsProps {
  customModels: ModelListRow[];
  catalogModels?: ProviderModelOption[];
  disabled?: boolean;
  density?: "default" | "compact";
  modelsError?: string | null;
  onCustomModelsChange: (models: ModelListRow[]) => void;
}

export function OpenCodeGoProviderModelFields({
  customModels,
  catalogModels: catalogModelsProp,
  disabled,
  density = "default",
  modelsError,
  onCustomModelsChange,
}: OpenCodeGoProviderModelFieldsProps) {
  const [isBrowsing, setIsBrowsing] = useState(false);
  const { data: modelsResponse } = useModelsQuery();

  const catalogModels = useMemo(() => {
    const fromApi = filterModelsByProvider(modelsResponse?.catalog ?? [], "opencode_go");
    if (fromApi.length > 0) {
      return fromApi;
    }

    return filterModelsByProvider(catalogModelsProp ?? [], "opencode_go");
  }, [catalogModelsProp, modelsResponse?.catalog]);

  const usedIds = useMemo(
    () => new Set(customModels.map((model) => model.id.trim()).filter(Boolean)),
    [customModels],
  );

  const addCatalogModel = (model: ProviderModelOption) => {
    if (usedIds.has(model.id)) {
      setIsBrowsing(false);
      return;
    }

    onCustomModelsChange([
      ...customModels,
      {
        id: model.id,
        name: model.name,
        ...(model.default ? { default: true } : {}),
        ...(model.inputPerMillionUsd !== undefined
          ? { inputPerMillionUsd: model.inputPerMillionUsd }
          : {}),
        ...(model.outputPerMillionUsd !== undefined
          ? { outputPerMillionUsd: model.outputPerMillionUsd }
          : {}),
      },
    ]);
    setIsBrowsing(false);
  };

  return (
    <FormField
      id="opencode-go-provider-models"
      label="Models"
      density={density}
      footer={
        modelsError ? (
          <p className="text-sm text-destructive" role="alert">
            {modelsError}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Choose which OpenCode Go models appear in chat for this provider.
          </p>
        )
      }
    >
      {isBrowsing ? (
        <div className="space-y-2">
          <OpenCodeGoModelsBrowseList
            models={catalogModels}
            usedIds={usedIds}
            onSelect={addCatalogModel}
            className="h-72 rounded-md border border-border"
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled || catalogModels.length === 0}
              onClick={() =>
                onCustomModelsChange(
                  catalogModels.map((model) => ({
                    id: model.id,
                    name: model.name,
                    default: model.default,
                    ...(model.inputPerMillionUsd !== undefined
                      ? { inputPerMillionUsd: model.inputPerMillionUsd }
                      : {}),
                    ...(model.outputPerMillionUsd !== undefined
                      ? { outputPerMillionUsd: model.outputPerMillionUsd }
                      : {}),
                  })),
                )
              }
            >
              Add all
            </Button>
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
          browseLabel="Browse OpenCode Go"
          onBrowse={() => setIsBrowsing(true)}
          onChange={onCustomModelsChange}
        />
      )}
    </FormField>
  );
}
