import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  ModelListEditor,
  type ModelListRow,
} from "@/components/ModelListEditor";
import { OpenCodeGoModelsBrowseList } from "@/components/OpenCodeGoModelsBrowseList";
import type { ProviderModelOption } from "@nakama/core/contract";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Spinner } from "@/components/ui/spinner";
import { useModelsQuery } from "@/hooks/use-app-queries";
import { client } from "@/lib/client";
import { filterModelsByProvider, formatProviderLabel, type SelectedProvider } from "@/lib/models";
import { queryKeys } from "@/lib/query-keys";

const CATALOG_SHORTLIST_PROVIDERS = ["openai", "anthropic", "gemini", "deepseek", "opencode_go"] as const;

export type CatalogShortlistProvider = (typeof CATALOG_SHORTLIST_PROVIDERS)[number];

const CATALOG_THINKING_TOGGLE_PROVIDERS = new Set<CatalogShortlistProvider>(["deepseek"]);

export function isCatalogShortlistProvider(
  provider: SelectedProvider,
): provider is CatalogShortlistProvider {
  return (CATALOG_SHORTLIST_PROVIDERS as readonly string[]).includes(provider);
}

function mergeBrowseModels(
  staticCatalog: ProviderModelOption[],
  remoteModels: ProviderModelOption[],
  provider: CatalogShortlistProvider,
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

  return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name));
}

interface CatalogProviderModelFieldsProps {
  provider: CatalogShortlistProvider;
  providerInstanceId?: string;
  customModels: ModelListRow[];
  catalogModels?: ProviderModelOption[];
  disabled?: boolean;
  density?: "default" | "compact";
  modelsError?: string | null;
  onCustomModelsChange: (models: ModelListRow[]) => void;
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
  const canDiscoverRemote = provider === "openai" && Boolean(providerInstanceId);

  const staticCatalog = useMemo(() => {
    const fromApi = filterModelsByProvider(
      modelsResponse?.catalog ?? modelsResponse?.models ?? [],
      provider,
    );
    if (fromApi.length > 0) {
      return fromApi;
    }

    return filterModelsByProvider(catalogModelsProp ?? [], provider);
  }, [catalogModelsProp, modelsResponse?.catalog, modelsResponse?.models, provider]);

  const {
    data: remoteResponse,
    isLoading: remoteLoading,
    error: remoteError,
  } = useQuery({
    queryKey: queryKeys.providerModelDiscovery(providerInstanceId ?? ""),
    queryFn: () => client.discoverModels({ providerId: providerInstanceId! }),
    enabled: isBrowsing && canDiscoverRemote,
    staleTime: 1000 * 60,
  });

  const browseModels = useMemo(() => {
    if (!canDiscoverRemote) {
      return staticCatalog;
    }

    return mergeBrowseModels(staticCatalog, remoteResponse?.models ?? [], provider);
  }, [canDiscoverRemote, provider, remoteResponse?.models, staticCatalog]);

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
        ...(model.supportsThinking !== undefined
          ? { supportsThinking: model.supportsThinking }
          : {}),
      },
    ]);
    setIsBrowsing(false);
  };

  const browseFooter = remoteError
    ? "Could not load models from OpenAI. Check the API key and try again."
    : remoteLoading
      ? "Loading models from OpenAI…"
      : `Choose which ${providerLabel} models appear in chat for this provider.`;

  return (
    <FormField
      id={`${provider}-provider-models`}
      label="Models"
      density={density}
      footer={
        modelsError ? (
          <p className="text-sm text-destructive" role="alert">
            {modelsError}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">{browseFooter}</p>
        )
      }
    >
      {isBrowsing ? (
        <div className="space-y-2">
          {remoteLoading ? (
            <div className="flex h-72 items-center justify-center rounded-md border border-border">
              <Spinner />
            </div>
          ) : (
            <OpenCodeGoModelsBrowseList
              models={browseModels}
              onSelect={addCatalogModel}
              className="h-72 rounded-md border border-border"
            />
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled || remoteLoading || browseModels.length === 0}
              onClick={() =>
                onCustomModelsChange(
                  browseModels.map((model) => ({
                    id: model.id,
                    name: model.name,
                    default: model.default,
                    ...(model.inputPerMillionUsd !== undefined
                      ? { inputPerMillionUsd: model.inputPerMillionUsd }
                      : {}),
                    ...(model.outputPerMillionUsd !== undefined
                      ? { outputPerMillionUsd: model.outputPerMillionUsd }
                      : {}),
                    ...(model.supportsThinking !== undefined
                      ? { supportsThinking: model.supportsThinking }
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
          showThinkingToggle={CATALOG_THINKING_TOGGLE_PROVIDERS.has(provider)}
          browseLabel={`Browse ${providerLabel}`}
          onBrowse={() => setIsBrowsing(true)}
          onChange={onCustomModelsChange}
        />
      )}
    </FormField>
  );
}
