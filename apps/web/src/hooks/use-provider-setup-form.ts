import type { CreateProviderResponse, ProviderModelOption } from "@nakama/core/contract";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ModelListRow } from "@/components/ModelListEditor";
import { normalizeModelListRows } from "@/components/model-list-editor.shared";
import type { ModelsDevRow } from "@/hooks/use-models-dev";
import type { OpenRouterModelRow } from "@/lib/openrouter-models";
import { useAppContext } from "@/context/use-app-context";
import { useAuth } from "@/context/use-auth";
import { useModelsQuery } from "@/hooks/use-app-queries";
import { formatError } from "@/lib/client";
import type { ProviderModelOption } from "@nakama/core/contract";
import {
  appendOpenRouterModelRow,
  buildCreateProviderRequest,
  defaultModelForProvider,
  filterModelsByProvider,
  getModelDisplayName,
  modelsFromCustomRows,
  modelsFromOpenRouterRows,
  type SelectedProvider,
  resolveOpenRouterSetupModel,
  validateApiKeyForProvider,
  validateBaseUrlInput,
  validateCustomModelsInput,
  validateDisplayNameInput,
  validateOpenRouterModelsInput,
} from "@/lib/models";

interface UseProviderSetupFormOptions {
  onSuccess?: (result: CreateProviderResponse) => void;
}

const EMPTY_CATALOG: ProviderModelOption[] = [];

export function useProviderSetupForm(options: UseProviderSetupFormOptions = {}) {
  const { createProvider } = useAppContext();
  const { isAuthenticated } = useAuth();
  const { data: catalogResponse, error: catalogQueryError } = useModelsQuery({
    enabled: isAuthenticated,
  });
  const catalog = catalogResponse?.catalog ?? catalogResponse?.models ?? EMPTY_CATALOG;

  const [selectedProvider, setSelectedProvider] = useState<SelectedProvider>("openai");
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeyTouched, setApiKeyTouched] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState("");
  const [openRouterModels, setOpenRouterModels] = useState<ModelListRow[]>([]);
  const [openRouterModelsError, setOpenRouterModelsError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [customModels, setCustomModels] = useState<ModelListRow[]>([{ id: "", name: "" }]);
  const [extraModels, setExtraModels] = useState<ProviderModelOption[]>([]);
  const [displayNameError, setDisplayNameError] = useState<string | null>(null);
  const [baseUrlError, setBaseUrlError] = useState<string | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (catalogQueryError) {
      setFormError(formatError(catalogQueryError));
    }
  }, [catalogQueryError]);

  const filteredModels = useMemo(() => {
    if (selectedProvider === "openai_compatible") {
      return modelsFromCustomRows(customModels);
    }

    if (selectedProvider === "openrouter") {
      return modelsFromOpenRouterRows(openRouterModels);
    }

    const catalogModels = filterModelsByProvider(catalog, selectedProvider);
    const catalogIds = new Set(catalogModels.map((model) => model.id));
    const extras = extraModels.filter(
      (model) => model.provider === selectedProvider && !catalogIds.has(model.id),
    );
    return [...catalogModels, ...extras];
  }, [catalog, selectedProvider, customModels, openRouterModels, extraModels]);

  useEffect(() => {
    if (filteredModels.length === 0) {
      return;
    }

    setSelectedModel((current) => {
      if (current && filteredModels.some((model) => model.id === current)) {
        return current;
      }

      return defaultModelForProvider(filteredModels, selectedProvider);
    });
  }, [selectedProvider, filteredModels]);

  const handleApiKeyBlur = useCallback(() => {
    setApiKeyTouched(true);
    setApiKeyError(validateApiKeyForProvider(apiKey, selectedProvider));
  }, [apiKey, selectedProvider]);

  const handleApiKeyChange = useCallback(
    (value: string) => {
      setApiKey(value);

      if (formError) {
        setFormError(null);
      }

      if (apiKeyTouched) {
        setApiKeyError(validateApiKeyForProvider(value, selectedProvider));
      } else if (apiKeyError) {
        setApiKeyError(null);
      }
    },
    [apiKeyTouched, apiKeyError, formError, selectedProvider],
  );

  const handleProviderSelect = useCallback(
    (provider: SelectedProvider) => {
      setSelectedProvider(provider);

      if (provider === "openrouter" && openRouterModels.length === 0) {
        setOpenRouterModels([{ id: "", name: "" }]);
      }

      if (provider !== "openrouter") {
        setOpenRouterModels([]);
        setOpenRouterModelsError(null);
      }

      if (provider !== "openai_compatible") {
        setBaseUrl("");
        setDisplayNameError(null);
        setBaseUrlError(null);
        setModelsError(null);
      }
    },
    [openRouterModels.length],
  );

  const selectOpenRouterModel = useCallback(
    (
      modelId: string,
      modelName: string,
      pricing?: { inputPerMillionUsd?: number; outputPerMillionUsd?: number },
    ) => {
      setOpenRouterModels((current) =>
        appendOpenRouterModelRow(current, modelId, modelName, pricing),
      );
      setSelectedModel(modelId);
      setOpenRouterModelsError(null);
    },
    [],
  );

  const handleBrowseSelect = useCallback(
    (provider: SelectedProvider, modelId: string, row: ModelsDevRow) => {
      handleProviderSelect(provider);
      if (provider === "openrouter") {
        selectOpenRouterModel(modelId, row.modelName);
      } else if (provider === "openai_compatible") {
        setDisplayName(row.providerName);
        setBaseUrl(row.apiUrl.replace(/\/$/, ""));
        setCustomModels([{ id: modelId, name: row.modelName }]);
        setSelectedModel(modelId);
        if (row.isZen && row.isFree && !row.deprecated) {
          setApiKey("public");
        }
      } else if (provider === "opencode_go") {
        setExtraModels((current) => {
          if (
            current.some(
              (model) => model.provider === provider && model.id === modelId,
            )
          ) {
            return current;
          }
          return [
            ...current,
            {
              id: modelId,
              name: row.modelName,
              provider,
              ...(row.context > 0 ? { contextWindow: row.context } : {}),
            },
          ];
        });
        setSelectedModel(modelId);
      } else {
        setExtraModels((current) => {
          if (
            current.some(
              (model) => model.provider === provider && model.id === modelId,
            )
          ) {
            return current;
          }
          return [
            ...current,
            {
              id: modelId,
              name: row.modelName,
              provider,
              ...(row.context > 0 ? { contextWindow: row.context } : {}),
            },
          ];
        });
        setSelectedModel(modelId);
        setBaseUrl(row.apiUrl.replace(/\/$/, ""));
      }
    },
    [handleProviderSelect, selectOpenRouterModel],
  );

  const handleOpenRouterBrowseSelect = useCallback(
    (row: OpenRouterModelRow) => {
      selectOpenRouterModel(row.id, row.name, {
        inputPerMillionUsd: row.inputPerMillionUsd,
        outputPerMillionUsd: row.outputPerMillionUsd,
      });
    },
    [selectOpenRouterModel],
  );

  const { onSuccess } = options;

  const handleOpenRouterModelsChange = useCallback((rows: ModelListRow[]) => {
    setOpenRouterModels(rows);
    setOpenRouterModelsError(null);
  }, []);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();

      const trimmedKey = apiKey.trim();
      const nextApiKeyError = validateApiKeyForProvider(trimmedKey, selectedProvider);
      const nextOpenRouterModelsError =
        selectedProvider === "openrouter"
          ? validateOpenRouterModelsInput(openRouterModels)
          : null;
      const nextDisplayNameError =
        selectedProvider === "openai_compatible"
          ? validateDisplayNameInput(displayName)
          : null;
      const nextBaseUrlError =
        selectedProvider === "openai_compatible" ? validateBaseUrlInput(baseUrl) : null;
      const nextModelsError =
        selectedProvider === "openai_compatible"
          ? validateCustomModelsInput(customModels)
          : null;

      setApiKeyTouched(true);
      setApiKeyError(nextApiKeyError);
      setOpenRouterModelsError(nextOpenRouterModelsError);
      setDisplayNameError(nextDisplayNameError);
      setBaseUrlError(nextBaseUrlError);
      setModelsError(nextModelsError);

      if (nextApiKeyError) {
        document.getElementById("api-key")?.focus();
        return;
      }

      if (nextOpenRouterModelsError) {
        return;
      }

      if (nextDisplayNameError) {
        document.getElementById("provider-display-name")?.focus();
        return;
      }

      if (nextBaseUrlError) {
        document.getElementById("provider-base-url")?.focus();
        return;
      }

      if (nextModelsError) {
        return;
      }

      const modelToSave =
        selectedProvider === "openrouter"
          ? resolveOpenRouterSetupModel(openRouterModels, selectedModel)
          : selectedModel;

      setBusy(true);
      setFormError(null);

      try {
        const result = await createProvider(
          buildCreateProviderRequest({
            apiKey: trimmedKey,
            provider: selectedProvider,
            model: modelToSave || undefined,
            displayName,
            baseUrl,
            customModels:
              selectedProvider === "openai_compatible"
                ? normalizeModelListRows(customModels)
                : selectedProvider === "openrouter"
                  ? normalizeModelListRows(openRouterModels)
                  : selectedProvider === "opencode_go" && modelToSave
                    ? normalizeModelListRows([
                        {
                          id: modelToSave,
                          name: getModelDisplayName(filteredModels, modelToSave),
                          default: true,
                        },
                      ])
                    : undefined,
          }),
        );
        setApiKey("");
        setApiKeyTouched(false);
        setShowApiKey(false);
        setOpenRouterModels([]);
        onSuccess?.(result);
      } catch (err) {
        setFormError(formatError(err));
        document.getElementById("api-key")?.focus();
      } finally {
        setBusy(false);
      }
    },
    [
      apiKey,
      baseUrl,
      openRouterModels,
      customModels,
      displayName,
      selectedModel,
      selectedProvider,
      createProvider,
      onSuccess,
      filteredModels,
    ],
  );

  return {
    catalog,
    selectedProvider,
    apiKey,
    showApiKey,
    apiKeyError,
    selectedModel,
    openRouterModels,
    openRouterModelsError,
    displayName,
    baseUrl,
    customModels,
    displayNameError,
    baseUrlError,
    modelsError,
    busy,
    formError,
    filteredModels,
    setSelectedModel,
    setShowApiKey,
    setDisplayName,
    setBaseUrl,
    setCustomModels,
    handleOpenRouterModelsChange,
    handleApiKeyBlur,
    handleApiKeyChange,
    handleProviderSelect,
    handleBrowseSelect,
    handleOpenRouterBrowseSelect,
    handleSubmit,
    formatSuccessMessage: (result: CreateProviderResponse) =>
      `${result.provider.label} connected with ${getModelDisplayName(catalog, result.initialModel)}.`,
  };
}
