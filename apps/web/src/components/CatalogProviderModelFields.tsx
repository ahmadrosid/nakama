import type { ProviderModelOption } from "@nakama/core/contract";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { CatalogShortlistProvider } from "@/components/catalog-provider-model-fields.shared";
import {
  ModelListEditor,
  type ModelListRow,
} from "@/components/ModelListEditor";
import { OpenCodeGoModelsBrowseList } from "@/components/OpenCodeGoModelsBrowseList";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Spinner } from "@/components/ui/spinner";
import { useModelsQuery } from "@/hooks/use-app-queries";
import { client } from "@/lib/client";
import { filterModelsByProvider, formatProviderLabel } from "@/lib/models";
import { queryKeys } from "@/lib/query-keys";

function modelListFieldsFromCatalog(model: ProviderModelOption): ModelListRow {
  return {
    id: model.id,
    name: model.name,
    ...(model.default ? { default: true } : {}),
    ...(model.inputPerMillionUsd === undefined
      ? {}
      : { inputPerMillionUsd: model.inputPerMillionUsd }),
    ...(model.outputPerMillionUsd === undefined
      ? {}
      : { outputPerMillionUsd: model.outputPerMillionUsd }),
    ...(model.supportsThinking === undefined
      ? {}
      : { supportsThinking: model.supportsThinking }),
    ...(model.supportsVision === undefined
      ? {}
      : { supportsVision: model.supportsVision }),
  };
}

function mergeBrowseModels(
  staticCatalog: ProviderModelOption[],
  remoteModels: ProviderModelOption[],
  provider: CatalogShortlistProvider
): ProviderModelOption[] {
  const byId = new Map<string, ProviderModelOption>();

  for (const model of staticCatalog) {
    byId.set(model.id, model);
  }

  for (const model of remoteModels) {
    const existing = byId.get(model.id);
    byId.set(model.id, {
      ...(existing ?? model),
      ...model,
      id: model.id,
      name: model.name?.trim() || existing?.name || model.id,
      provider,
    });
  }

  return [...byId.values()].sort((left, right) =>
    left.name.localeCompare(right.name)
  );
}

interface CatalogProviderModelFieldsProps {
  catalogModels?: ProviderModelOption[];
  customModels: ModelListRow[];
  density?: "default" | "compact";
  disabled?: boolean;
  modelsError?: string | null;
  onCustomModelsChange: (models: ModelListRow[]) => void;
  provider: CatalogShortlistProvider;
  providerInstanceId?: string;
}

export function CatalogProviderModelFields({
  provider,
  providerInstanceId,
  customModels,
  catalogModels: catalogModelsProp,
  disabled,
  density = "default",
  modelsError,
  onCustomModelsChange,
}: CatalogProviderModelFieldsProps) {
  const [isBrowsing, setIsBrowsing] = useState(false);
  const { data: modelsResponse } = useModelsQuery();
  const providerLabel = formatProviderLabel(provider);
  const canDiscoverRemote =
    provider === "openai" && Boolean(providerInstanceId);

  const staticCatalog = useMemo(() => {
    const fromApi = filterModelsByProvider(
      modelsResponse?.catalog ?? modelsResponse?.models ?? [],
      provider
    );
    if (fromApi.length > 0) {
      return fromApi;
    }

    return filterModelsByProvider(catalogModelsProp ?? [], provider);
  }, [
    catalogModelsProp,
    modelsResponse?.catalog,
    modelsResponse?.models,
    provider,
  ]);

  const {
    data: remoteResponse,
    isLoading: remoteLoading,
    error: remoteError,
  } = useQuery({
    enabled: isBrowsing && canDiscoverRemote,
    queryFn: () => client.discoverModels({ providerId: providerInstanceId! }),
    queryKey: queryKeys.providerModelDiscovery(providerInstanceId ?? ""),
    staleTime: 1000 * 60,
  });

  const browseModels = useMemo(() => {
    if (!canDiscoverRemote) {
      return staticCatalog;
    }

    return mergeBrowseModels(
      staticCatalog,
      remoteResponse?.models ?? [],
      provider
    );
  }, [canDiscoverRemote, provider, remoteResponse?.models, staticCatalog]);

  const usedIds = useMemo(
    () =>
      new Set(
        customModels.flatMap((model) => {
          const id = model.id.trim();
          return id ? [id] : [];
        })
      ),
    [customModels]
  );

  const addCatalogModel = (model: ProviderModelOption) => {
    if (usedIds.has(model.id)) {
      setIsBrowsing(false);
      return;
    }

    onCustomModelsChange([...customModels, modelListFieldsFromCatalog(model)]);
    setIsBrowsing(false);
  };

  const browseFooter = remoteError
    ? "Could not load models from OpenAI. Check the API key and try again."
    : remoteLoading
      ? "Loading models from OpenAI…"
      : `Choose which ${providerLabel} models appear in chat for this provider.`;

  return (
    <FormField
      density={density}
      footer={
        modelsError ? (
          <p className="text-destructive text-sm" role="alert">
            {modelsError}
          </p>
        ) : (
          <p className="text-muted-foreground text-xs">{browseFooter}</p>
        )
      }
      id={`${provider}-provider-models`}
      label="Models"
    >
      {isBrowsing ? (
        <div className="space-y-2">
          {remoteLoading ? (
            <div className="flex h-72 items-center justify-center rounded-md border border-border">
              <Spinner />
            </div>
          ) : (
            <OpenCodeGoModelsBrowseList
              className="h-72 rounded-md border border-border"
              models={browseModels}
              onSelect={addCatalogModel}
            />
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              disabled={disabled || remoteLoading || browseModels.length === 0}
              onClick={() =>
                onCustomModelsChange(
                  browseModels.map(modelListFieldsFromCatalog)
                )
              }
              size="sm"
              type="button"
              variant="outline"
            >
              Add all
            </Button>
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
          browseLabel={`Browse ${providerLabel}`}
          disabled={disabled}
          models={customModels}
          onBrowse={() => setIsBrowsing(true)}
          onChange={onCustomModelsChange}
          showPricing
          showVision
          visionDefaultOn={
            provider === "openai" ||
            provider === "anthropic" ||
            provider === "gemini"
          }
        />
      )}
    </FormField>
  );
}
