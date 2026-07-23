import type { CreateProviderResponse, OllamaHostMode, ProviderModelOption } from "@nakama/core/contract";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ModelListRow } from "@/components/ModelListEditor";
import { normalizeModelListRows } from "@/components/model-list-editor.shared";
import type { ModelsDevRow } from "@/hooks/use-models-dev";
import { useAppContext } from "@/context/use-app-context";
import { useAuth } from "@/context/use-auth";
import { useModelsQuery, useProvidersQuery } from "@/hooks/use-app-queries";
import { formatError } from "@/lib/client";
import {
  appendOpenRouterModelRow,
  buildCreateProviderRequest,
  defaultModelForProvider,
  defaultOllamaSetupBaseUrl,
  filterModelsByProvider,
  firstAvailableProviderOption,
  getModelDisplayName,
  hasOpenCodeZenProvider,
  isProviderTypeAlreadyConfigured,
  modelsFromCerebrasRows,
  modelsFromCustomRows,
  modelsFromOpenRouterRows,
  type SelectedProvider,
  resolveCerebrasSetupModel,
  resolveOpenRouterSetupModel,
  validateApiKeyForProvider,
  validateBaseUrlInput,
  validateCerebrasModelsInput,
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
  const { data: providersResponse } = useProvidersQuery({
    enabled: isAuthenticated,
  });
  const catalog = catalogResponse?.catalog ?? catalogResponse?.models ?? EMPTY_CATALOG;

  const configuredTypes = useMemo(() => {
    const types = new Set<string>();
    for (const provider of providersResponse?.providers ?? []) {
      types.add(provider.type);
    }
    return types;
  }, [providersResponse?.providers]);

  const openCodeZenConfigured = useMemo(
    () => hasOpenCodeZenProvider(providersResponse?.providers ?? []),
    [providersResponse?.providers],
  );

  const [selectedProvider, setSelectedProvider] = useState<SelectedProvider>("openai");
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeyTouched, setApiKeyTouched] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState("");
  const [openRouterModels, setOpenRouterModels] = useState<ModelListRow[]>([]);
  const [openRouterModelsError, setOpenRouterModelsError] = useState<string | null>(null);
  const [cerebrasModels, setCerebrasModels] = useState<ModelListRow[]>([]);
  const [cerebrasModelsError, setCerebrasModelsError] = useState<string | null>(null);
  const [ollamaHostMode, setOllamaHostMode] = useState<OllamaHostMode>("local");
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

  useEffect(() => {
    setSelectedProvider((current) => {
      if (!isProviderTypeAlreadyConfigured(current, configuredTypes)) {
        return current;
      }

      return firstAvailableProviderOption(configuredTypes, current);
    });
  }, [configuredTypes]);

  const filteredModels = useMemo(() => {
    if (selectedProvider === "openai_compatible" || selectedProvider === "ollama") {
      return modelsFromCustomRows(customModels).map((model) =>
        selectedProvider === "ollama" ? { ...model, provider: "ollama" as const } : model,
      );
    }

    if (selectedProvider === "openrouter") {
      return modelsFromOpenRouterRows(openRouterModels);
    }

    if (selectedProvider === "cerebras") {
      return modelsFromCerebrasRows(cerebrasModels);
    }

    const catalogModels = filterModelsByProvider(catalog, selectedProvider);
    const catalogIds = new Set(catalogModels.map((model) => model.id));
    const extras = extraModels.filter(
      (model) => model.provider === selectedProvider && !catalogIds.has(model.id),
    );
    return [...catalogModels, ...extras];
  }, [catalog, selectedProvider, customModels, openRouterModels, cerebrasModels, extraModels]);

  const ollamaApiKeyOptions = useMemo(
    () => ({ ollamaHostMode }),
    [ollamaHostMode],
  );

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
    setApiKeyError(validateApiKeyForProvider(apiKey, selectedProvider, ollamaApiKeyOptions));
  }, [apiKey, selectedProvider, ollamaApiKeyOptions]);

  const handleApiKeyChange = useCallback(
    (value: string) => {
      setApiKey(value);

      if (formError) {
        setFormError(null);
      }

      if (apiKeyTouched) {
        setApiKeyError(validateApiKeyForProvider(value, selectedProvider, ollamaApiKeyOptions));
      } else if (apiKeyError) {
        setApiKeyError(null);
      }
    },
    [apiKeyTouched, apiKeyError, formError, selectedProvider, ollamaApiKeyOptions],
  );

  const handleProviderSelect = useCallback(
    (provider: SelectedProvider) => {
      if (isProviderTypeAlreadyConfigured(provider, configuredTypes)) {
        return;
      }

      setSelectedProvider(provider);

      if (provider === "openrouter" && openRouterModels.length === 0) {
        setOpenRouterModels([{ id: "", name: "" }]);
      }

      if (provider === "cerebras" && cerebrasModels.length === 0) {
        setCerebrasModels([{ id: "", name: "" }]);
      }

      if (provider === "ollama") {
        setOllamaHostMode("local");
        setBaseUrl(defaultOllamaSetupBaseUrl("local"));
        setCustomModels([{ id: "", name: "" }]);
      }

      if (provider !== "openrouter") {
        setOpenRouterModels([]);
        setOpenRouterModelsError(null);
      }

      if (provider !== "cerebras") {
        setCerebrasModels([]);
        setCerebrasModelsError(null);
      }

      if (provider !== "openai_compatible" && provider !== "ollama") {
        setBaseUrl("");
        setDisplayNameError(null);
        setBaseUrlError(null);
        setModelsError(null);
      }

      if (provider === "openai_compatible") {
        setBaseUrl("");
        setCustomModels([{ id: "", name: "" }]);
      }
    },
    [configuredTypes, openRouterModels.length, cerebrasModels.length],
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
      if (isProviderTypeAlreadyConfigured(provider, configuredTypes)) {
        return;
      }

      if (row.isZen && openCodeZenConfigured) {
        return;
      }

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
    [configuredTypes, openCodeZenConfigured, handleProviderSelect, selectOpenRouterModel],
  );

  const { onSuccess } = options;

  const handleCerebrasModelsChange = useCallback((rows: ModelListRow[]) => {
    setCerebrasModels(rows);
    setCerebrasModelsError(null);
  }, []);

  const handleOllamaHostModeChange = useCallback(
    (hostMode: OllamaHostMode) => {
      setOllamaHostMode(hostMode);
      if (apiKeyTouched) {
        setApiKeyError(
          validateApiKeyForProvider(apiKey, "ollama", { ollamaHostMode: hostMode }),
        );
      } else {
        setApiKeyError(null);
      }
    },
    [apiKey, apiKeyTouched],
  );

  const handleOpenRouterModelsChange = useCallback((rows: ModelListRow[]) => {
    setOpenRouterModels(rows);
    setOpenRouterModelsError(null);
  }, []);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();

      const trimmedKey = apiKey.trim();
      const nextApiKeyError = validateApiKeyForProvider(
        trimmedKey,
        selectedProvider,
        ollamaApiKeyOptions,
      );
      const nextOpenRouterModelsError =
        selectedProvider === "openrouter"
          ? validateOpenRouterModelsInput(openRouterModels)
          : null;
      const nextCerebrasModelsError =
        selectedProvider === "cerebras"
          ? validateCerebrasModelsInput(cerebrasModels)
          : null;
      const nextDisplayNameError =
        selectedProvider === "openai_compatible"
          ? validateDisplayNameInput(displayName)
          : null;
      const nextBaseUrlError =
        selectedProvider === "openai_compatible" || selectedProvider === "ollama"
          ? validateBaseUrlInput(baseUrl)
          : null;
      const nextModelsError =
        selectedProvider === "openai_compatible" || selectedProvider === "ollama"
          ? validateCustomModelsInput(customModels)
          : null;

      setApiKeyTouched(true);
      setApiKeyError(nextApiKeyError);
      setOpenRouterModelsError(nextOpenRouterModelsError);
      setCerebrasModelsError(nextCerebrasModelsError);
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

      if (nextCerebrasModelsError) {
        return;
      }

      if (nextDisplayNameError) {
        document.getElementById("provider-display-name")?.focus();
        return;
      }

      if (nextBaseUrlError) {
        document.getElementById(
          selectedProvider === "ollama" ? "ollama-base-url" : "provider-base-url",
        )?.focus();
        return;
      }

      if (nextModelsError) {
        return;
      }

      if (isProviderTypeAlreadyConfigured(selectedProvider, configuredTypes)) {
        setFormError("This provider is already added.");
        return;
      }

      const modelToSave =
        selectedProvider === "openrouter"
          ? resolveOpenRouterSetupModel(openRouterModels, selectedModel)
          : selectedProvider === "cerebras"
            ? resolveCerebrasSetupModel(cerebrasModels, selectedModel)
            : selectedProvider === "ollama"
              ? resolveOpenRouterSetupModel(customModels, selectedModel)
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
            hostMode: selectedProvider === "ollama" ? ollamaHostMode : undefined,
            customModels:
              selectedProvider === "openai_compatible" || selectedProvider === "ollama"
                ? normalizeModelListRows(customModels)
                : selectedProvider === "openrouter"
                  ? normalizeModelListRows(openRouterModels)
                  : selectedProvider === "cerebras"
                    ? normalizeModelListRows(cerebrasModels)
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
        setCerebrasModels([]);
        setCustomModels([{ id: "", name: "" }]);
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
      cerebrasModels,
      ollamaHostMode,
      ollamaApiKeyOptions,
      customModels,
      displayName,
      selectedModel,
      selectedProvider,
      configuredTypes,
      createProvider,
      onSuccess,
      filteredModels,
    ],
  );

  return {
    catalog,
    configuredTypes,
    openCodeZenConfigured,
    selectedProvider,
    apiKey,
    showApiKey,
    apiKeyError,
    selectedModel,
    openRouterModels,
    openRouterModelsError,
    cerebrasModels,
    cerebrasModelsError,
    ollamaHostMode,
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
    handleCerebrasModelsChange,
    handleOllamaHostModeChange,
    handleApiKeyBlur,
    handleApiKeyChange,
    handleProviderSelect,
    handleBrowseSelect,
    handleSubmit,
    formatSuccessMessage: (result: CreateProviderResponse) =>
      `${result.provider.label} connected with ${getModelDisplayName(catalog, result.initialModel)}.`,
  };
}
