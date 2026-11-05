import { resolveCloudflareAccountInput } from "@nakama/core/cloudflare-provider-config";
import type {
  ChatgptOAuthCredentials,
  CreateProviderResponse,
  CustomModelEntry,
  OllamaHostMode,
  OpenRouterRoutingSettings,
  ProviderModelOption,
  WireApi,
  XaiOAuthCredentials,
} from "@nakama/core/contract";
import { defaultDiscoveryBaseUrl } from "@nakama/core/discovery-providers";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ModelListRow } from "@/components/ModelListEditor";
import { normalizeModelListRows } from "@/components/model-list-editor.shared";
import { useAppContext } from "@/context/use-app-context";
import { useAuth } from "@/context/use-auth";
import { useModelsQuery, useProvidersQuery } from "@/hooks/use-app-queries";
import { formatError } from "@/lib/client";
import {
  buildCreateProviderRequest,
  defaultModelForProvider,
  defaultOllamaSetupBaseUrl,
  filterModelsByProvider,
  firstAvailableProviderOption,
  getModelDisplayName,
  isProviderTypeAlreadyConfigured,
  isShortlistCapabilityProvider,
  modelsFromCustomRows,
  modelsFromOpenRouterRows,
  modelsFromShortlistRows,
  resolveOpenRouterSetupModel,
  type SelectedProvider,
  validateApiKeyForProvider,
  validateBaseUrlInput,
  validateCustomModelsInput,
  validateDisplayNameInput,
  validateOpenRouterModelsInput,
  validateShortlistCapabilityModelsInput,
} from "@/lib/models";

interface UseProviderSetupFormOptions {
  onSuccess?: (result: CreateProviderResponse) => void;
}

const EMPTY_CATALOG: ProviderModelOption[] = [];

export function useProviderSetupForm(
  options: UseProviderSetupFormOptions = {}
) {
  const { createProvider } = useAppContext();
  const { isAuthenticated } = useAuth();

  const { data: catalogResponse, error: catalogQueryError } = useModelsQuery({
    enabled: isAuthenticated,
  });

  const { data: providersResponse } = useProvidersQuery({
    enabled: isAuthenticated,
  });

  const catalog =
    catalogResponse?.catalog ?? catalogResponse?.models ?? EMPTY_CATALOG;

  const configuredTypes = useMemo(() => {
    const types = new Set<string>();

    for (const provider of providersResponse?.providers ?? []) {
      types.add(provider.type);
    }

    return types;
  }, [providersResponse?.providers]);

  const [selectedProvider, setSelectedProvider] =
    useState<SelectedProvider>("openai");

  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeyTouched, setApiKeyTouched] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState("");
  const [openRouterModels, setOpenRouterModels] = useState<ModelListRow[]>([]);

  const [openRouterRouting, setOpenRouterRouting] =
    useState<OpenRouterRoutingSettings>({});

  const [openRouterModelsError, setOpenRouterModelsError] = useState<
    string | null
  >(null);

  const [shortlistModels, setShortlistModels] = useState<ModelListRow[]>([]);

  const [shortlistModelsError, setShortlistModelsError] = useState<
    string | null
  >(null);

  const [ollamaHostMode, setOllamaHostMode] = useState<OllamaHostMode>("local");
  const [displayName, setDisplayName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [wireApi, setWireApi] = useState<WireApi>("chat");
  const [customModels, setCustomModels] = useState<ModelListRow[]>([]);

  const [subscriptionModels, setSubscriptionModels] = useState<
    ProviderModelOption[]
  >([]);

  const [displayNameError, setDisplayNameError] = useState<string | null>(null);
  const [baseUrlError, setBaseUrlError] = useState<string | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [xaiOAuth, setXaiOAuth] = useState<XaiOAuthCredentials | null>(null);

  const [chatgptOAuth, setChatgptOAuth] =
    useState<ChatgptOAuthCredentials | null>(null);

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
    if (
      selectedProvider === "openai_compatible" ||
      selectedProvider === "netra" ||
      selectedProvider === "ollama"
    ) {
      return modelsFromCustomRows(customModels).map((model) =>
        selectedProvider === "ollama"
          ? { ...model, provider: "ollama" as const }
          : selectedProvider === "netra"
            ? { ...model, provider: "netra" as const }
            : model
      );
    }

    if (selectedProvider === "openrouter") {
      return modelsFromOpenRouterRows(openRouterModels);
    }

    if (isShortlistCapabilityProvider(selectedProvider)) {
      return modelsFromShortlistRows(selectedProvider, shortlistModels);
    }

    if (
      (selectedProvider === "chatgpt" || selectedProvider === "xai_oauth") &&
      subscriptionModels.length > 0
    ) {
      return subscriptionModels;
    }

    return filterModelsByProvider(catalog, selectedProvider);
  }, [
    catalog,
    selectedProvider,
    customModels,
    openRouterModels,
    shortlistModels,
    subscriptionModels,
  ]);

  const ollamaApiKeyOptions = useMemo(
    () => ({ ollamaHostMode }),
    [ollamaHostMode]
  );

  useEffect(() => {
    if (filteredModels.length === 0) {
      setSelectedModel("");

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
    setApiKeyError(
      validateApiKeyForProvider(apiKey, selectedProvider, ollamaApiKeyOptions)
    );
  }, [apiKey, selectedProvider, ollamaApiKeyOptions]);

  const handleApiKeyChange = useCallback(
    (value: string) => {
      setApiKey(value);

      if (formError) {
        setFormError(null);
      }

      if (apiKeyTouched) {
        setApiKeyError(
          validateApiKeyForProvider(
            value,
            selectedProvider,
            ollamaApiKeyOptions
          )
        );
      } else if (apiKeyError) {
        setApiKeyError(null);
      }
    },
    [
      apiKeyTouched,
      apiKeyError,
      formError,
      selectedProvider,
      ollamaApiKeyOptions,
    ]
  );

  const handleProviderSelect = useCallback(
    (provider: SelectedProvider) => {
      if (isProviderTypeAlreadyConfigured(provider, configuredTypes)) {
        return;
      }

      setSelectedProvider(provider);
      // The last provider's model never fits the new one.
      setSelectedModel("");
      setFormError(null);
      setApiKeyError(null);
      setApiKeyTouched(false);
      setDisplayNameError(null);
      setBaseUrlError(null);
      setModelsError(null);
      // A name or key typed for one provider must not carry to the next one.
      setDisplayName("");
      setApiKey("");

      if (provider === "ollama") {
        setOllamaHostMode("local");
        setBaseUrl(defaultOllamaSetupBaseUrl("local"));
        setCustomModels([]);
      }

      if (provider === "netra") {
        setBaseUrl(defaultDiscoveryBaseUrl("netra") ?? "");
        setDisplayName("Netra Runtime");
        setCustomModels([]);
      }

      if (provider !== "openrouter") {
        setOpenRouterModels([]);
        setOpenRouterModelsError(null);
      }

      if (!isShortlistCapabilityProvider(provider)) {
        setShortlistModels([]);
        setShortlistModelsError(null);
      }

      if (
        provider !== "openai_compatible" &&
        provider !== "ollama" &&
        provider !== "netra"
      ) {
        setBaseUrl("");
      }

      if (provider === "openai_compatible") {
        setBaseUrl("");
        setCustomModels([]);
      }

      setXaiOAuth(null);
      setSubscriptionModels([]);

      if (provider !== "chatgpt") {
        setChatgptOAuth(null);
      }
    },
    [configuredTypes]
  );

  const handleSubscriptionModelsChange = useCallback(
    (entries: CustomModelEntry[]) => {
      setSubscriptionModels(
        entries.map((entry, index) => ({
          default: entry.default === true || index === 0,
          id: entry.id,
          name: entry.name?.trim() || entry.id,
          provider: selectedProvider,
          supportsVision: entry.supportsVision !== false,
        }))
      );
    },
    [selectedProvider]
  );

  const { onSuccess } = options;

  const handleShortlistModelsChange = useCallback((rows: ModelListRow[]) => {
    setShortlistModels(rows);
    setShortlistModelsError(null);
  }, []);

  const handleOllamaHostModeChange = useCallback(
    (hostMode: OllamaHostMode) => {
      setOllamaHostMode(hostMode);

      if (apiKeyTouched) {
        setApiKeyError(
          validateApiKeyForProvider(apiKey, "ollama", {
            ollamaHostMode: hostMode,
          })
        );
      } else {
        setApiKeyError(null);
      }
    },
    [apiKey, apiKeyTouched]
  );

  const handleDisplayNameChange = useCallback((value: string) => {
    setDisplayName(value);
    setDisplayNameError(null);
    setFormError(null);
  }, []);

  const handleBaseUrlChange = useCallback((value: string) => {
    setBaseUrl(value);
    setBaseUrlError(null);
    setFormError(null);
  }, []);

  const handleBaseUrlBlur = useCallback(() => {
    if (baseUrl.trim()) {
      setBaseUrlError(validateBaseUrlInput(baseUrl));
    }
  }, [baseUrl]);

  const handleBaseUrlRequired = useCallback(() => {
    setBaseUrlError(validateBaseUrlInput(baseUrl));
    document.getElementById("provider-base-url")?.focus();
  }, [baseUrl]);

  const handleCustomModelsChange = useCallback((rows: ModelListRow[]) => {
    setCustomModels(rows);
    setModelsError(null);
    setFormError(null);
  }, []);

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
        ollamaApiKeyOptions
      );

      const nextOpenRouterModelsError =
        selectedProvider === "openrouter"
          ? validateOpenRouterModelsInput(openRouterModels)
          : null;

      const nextShortlistModelsError = isShortlistCapabilityProvider(
        selectedProvider
      )
        ? validateShortlistCapabilityModelsInput(shortlistModels)
        : null;

      const nextDisplayNameError =
        selectedProvider === "openai_compatible"
          ? validateDisplayNameInput(displayName)
          : null;

      const nextBaseUrlError =
        selectedProvider === "openai_compatible" ||
        selectedProvider === "ollama"
          ? validateBaseUrlInput(baseUrl)
          : selectedProvider === "cloudflare"
            ? resolveCloudflareAccountInput(baseUrl)
              ? null
              : "Enter a Cloudflare account ID or Workers AI URL."
            : null;

      const nextModelsError =
        selectedProvider === "openai_compatible" ||
        selectedProvider === "netra" ||
        selectedProvider === "ollama"
          ? validateCustomModelsInput(customModels)
          : null;

      setApiKeyTouched(true);
      setApiKeyError(nextApiKeyError);
      setOpenRouterModelsError(nextOpenRouterModelsError);
      setShortlistModelsError(nextShortlistModelsError);
      setDisplayNameError(nextDisplayNameError);
      setBaseUrlError(nextBaseUrlError);
      setModelsError(nextModelsError);

      if (nextApiKeyError) {
        document.getElementById("api-key")?.focus();

        return;
      }

      if (nextOpenRouterModelsError) {
        focusModelsField();

        return;
      }

      if (nextShortlistModelsError) {
        focusModelsField();

        return;
      }

      if (nextDisplayNameError) {
        document.getElementById("provider-display-name")?.focus();

        return;
      }

      if (nextBaseUrlError) {
        document
          .getElementById(
            selectedProvider === "ollama"
              ? "ollama-base-url"
              : selectedProvider === "cloudflare"
                ? "cloudflare-account-id"
                : "provider-base-url"
          )
          ?.focus();

        return;
      }

      if (nextModelsError) {
        focusModelsField();

        return;
      }

      if (isProviderTypeAlreadyConfigured(selectedProvider, configuredTypes)) {
        setFormError("This provider is already added.");

        return;
      }

      if (selectedProvider === "xai_oauth" && !xaiOAuth) {
        setFormError("Sign in with Grok before saving.");

        return;
      }

      if (selectedProvider === "chatgpt" && !chatgptOAuth) {
        setFormError("Sign in with ChatGPT before saving.");

        return;
      }

      const modelToSave =
        selectedProvider === "openrouter"
          ? resolveOpenRouterSetupModel(openRouterModels, selectedModel)
          : isShortlistCapabilityProvider(selectedProvider)
            ? resolveOpenRouterSetupModel(shortlistModels, selectedModel)
            : selectedProvider === "ollama"
              ? resolveOpenRouterSetupModel(customModels, selectedModel)
              : selectedModel;

      setBusy(true);
      setFormError(null);

      try {
        const resolvedCloudflareBaseUrl =
          selectedProvider === "cloudflare"
            ? resolveCloudflareAccountInput(baseUrl)
            : null;

        const result = await createProvider(
          buildCreateProviderRequest({
            apiKey: trimmedKey,
            baseUrl: resolvedCloudflareBaseUrl ?? baseUrl,
            chatgptOAuth: chatgptOAuth ?? undefined,
            customModels:
              (selectedProvider === "chatgpt" && subscriptionModels.length) ||
              selectedProvider === "xai_oauth"
                ? filteredModels.map((entry) => ({
                    default: entry.id === modelToSave,
                    id: entry.id,
                    name: entry.name,
                    supportsVision: entry.supportsVision !== false,
                  }))
                : selectedProvider === "openai_compatible" ||
                    selectedProvider === "netra" ||
                    selectedProvider === "ollama"
                  ? normalizeModelListRows(customModels).map((entry) => ({
                      ...entry,
                      default: entry.id === modelToSave,
                    }))
                  : selectedProvider === "openrouter"
                    ? normalizeModelListRows(openRouterModels)
                    : isShortlistCapabilityProvider(selectedProvider)
                      ? normalizeModelListRows(shortlistModels)
                      : selectedProvider === "opencode_go" && modelToSave
                        ? normalizeModelListRows([
                            {
                              default: true,
                              id: modelToSave,
                              name: getModelDisplayName(
                                filteredModels,
                                modelToSave
                              ),
                            },
                          ])
                        : undefined,
            displayName,
            hostMode:
              selectedProvider === "ollama" ? ollamaHostMode : undefined,
            model: modelToSave || undefined,
            openRouterRouting,
            provider: selectedProvider,
            wireApi:
              selectedProvider === "openai_compatible" ? wireApi : undefined,
            xaiOAuth:
              selectedProvider === "xai_oauth"
                ? (xaiOAuth ?? undefined)
                : undefined,
          })
        );

        setApiKey("");
        setApiKeyTouched(false);
        setShowApiKey(false);
        setXaiOAuth(null);
        setChatgptOAuth(null);
        setSubscriptionModels([]);
        setOpenRouterModels([]);
        setOpenRouterRouting({});
        setShortlistModels([]);
        setCustomModels([]);
        onSuccess?.(result);
      } catch (err) {
        const message = formatError(err);

        // Focus the key only when the key is the problem; the form error
        // shows by the submit button.
        if (trimmedKey && /API key/i.test(message)) {
          setApiKeyError(message);
          document.getElementById("api-key")?.focus();
        } else {
          setFormError(message);
        }
      } finally {
        setBusy(false);
      }
    },
    [
      apiKey,
      baseUrl,
      xaiOAuth,
      chatgptOAuth,
      openRouterModels,
      openRouterRouting,
      shortlistModels,
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
      subscriptionModels,
      wireApi,
    ]
  );

  // A typed key, name or picked model is work the user would lose.
  const dirty =
    apiKey.trim() !== "" ||
    displayName.trim() !== "" ||
    customModels.length > 0 ||
    openRouterModels.length > 0 ||
    shortlistModels.length > 0;

  return {
    apiKey,
    apiKeyError,
    baseUrl,
    baseUrlError,
    busy,
    catalog,
    chatgptOAuth,
    configuredTypes,
    customModels,
    dirty,
    displayName,
    displayNameError,
    filteredModels,
    formatSuccessMessage: (result: CreateProviderResponse) =>
      `${result.provider.label} connected with ${getModelDisplayName(catalog, result.initialModel)}.`,
    formError,
    handleApiKeyBlur,
    handleApiKeyChange,
    handleBaseUrlBlur,
    handleBaseUrlChange,
    handleBaseUrlRequired,
    handleCustomModelsChange,
    handleDisplayNameChange,
    handleOllamaHostModeChange,
    handleOpenRouterModelsChange,
    handleProviderSelect,
    handleShortlistModelsChange,
    handleSubmit,
    handleSubscriptionModelsChange,
    modelsError,
    ollamaHostMode,
    openRouterModels,
    openRouterModelsError,
    openRouterRouting,
    selectedModel,
    selectedProvider,
    setChatgptOAuth,
    setOpenRouterRouting,
    setSelectedModel,
    setShowApiKey,
    setWireApi,
    setXaiOAuth,
    shortlistModels,
    shortlistModelsError,
    showApiKey,
    wireApi,
    xaiOAuth,
  };
}

// The models field has no single input. "Add model by ID" works even when
// the endpoint cannot list models, so it takes focus first.
function focusModelsField() {
  const label = document.querySelector('label[for$="-models"]');
  const field = label?.parentElement?.parentElement;

  const addById = [...(field?.querySelectorAll("button") ?? [])].find(
    (button) => button.textContent?.trim() === "Add model by ID"
  );

  field?.scrollIntoView({ block: "center" });
  (addById ?? field?.querySelector<HTMLElement>("input, button"))?.focus();
}
