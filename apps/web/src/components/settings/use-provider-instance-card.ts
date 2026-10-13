import type {
  ChatgptOAuthCredentials,
  CustomModelEntry,
  OpenRouterRoutingSettings,
  ProviderInstanceSummary,
  ProviderModelOption,
  UpdateProviderRequest,
  WireApi,
  XaiOAuthCredentials,
} from "@nakama/core/contract";
import {
  defaultDiscoveryBaseUrl,
  isDiscoveryModelProvider,
} from "@nakama/core/discovery-providers";
import { useMemo, useState } from "react";
import { isCatalogShortlistProvider } from "@/components/catalog-provider-model-fields.shared";
import type { ModelListRow } from "@/components/ModelListEditor";
import { normalizeModelListRows } from "@/components/model-list-editor.shared";
import { isShortlistBrowseProvider } from "@/components/shortlist-browse-providers.shared";
import { formatError } from "@/lib/client";
import {
  defaultOllamaSetupBaseUrl,
  type SelectedProvider,
  validateApiKeyForProvider,
  validateBaseUrlInput,
  validateCustomModelsInput,
  validateDisplayNameInput,
  validateOpenCodeGoModelsInput,
  validateOpenRouterModelsInput,
  validateShortlistCapabilityModelsInput,
} from "@/lib/models";

function seedManageModelRows(
  customModels: CustomModelEntry[] | undefined,
  configuredModels: ProviderModelOption[]
): ModelListRow[] {
  const models: CustomModelEntry[] = customModels?.length
    ? customModels
    : configuredModels;

  return models.map((model) => ({
    cachedInputPerMillionUsd: model.cachedInputPerMillionUsd,
    contextWindow: model.contextWindow,
    default: model.default,
    id: model.id,
    inputPerMillionUsd: model.inputPerMillionUsd,
    maxOutputTokens: model.maxOutputTokens,
    name: model.name ?? model.id,
    outputPerMillionUsd: model.outputPerMillionUsd,
    supportsThinking: model.supportsThinking,
    supportsVision: model.supportsVision,
  }));
}

export function useProviderInstanceCard({
  instance,
  catalog,
  onUpdate,
  onDelete,
  onError,
}: {
  instance: ProviderInstanceSummary;
  catalog: ProviderModelOption[];
  onUpdate: (
    providerId: string,
    request: UpdateProviderRequest
  ) => Promise<void>;
  onDelete: (providerId: string) => Promise<void>;
  onError: (error: string | null) => void;
}) {
  const [replaceKeyOpen, setReplaceKeyOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [xaiOAuth, setXaiOAuth] = useState<XaiOAuthCredentials | null>(null);

  const [chatgptOAuth, setChatgptOAuth] =
    useState<ChatgptOAuthCredentials | null>(null);

  const [showApiKey, setShowApiKey] = useState(false);
  const [editLabel, setEditLabel] = useState("");
  const [editBaseUrl, setEditBaseUrl] = useState("");
  const [editWireApi, setEditWireApi] = useState<WireApi>("chat");
  const [manageModels, setManageModels] = useState<ModelListRow[]>([]);

  const [openRouterRouting, setOpenRouterRouting] =
    useState<OpenRouterRoutingSettings>({});

  // SAFETY: Provider instance summaries use the selected-provider contract.
  const providerType = instance.type as SelectedProvider;
  const isXaiOAuth = providerType === "xai_oauth";
  const isChatgpt = providerType === "chatgpt";
  const isOllama = providerType === "ollama";
  // Discovery providers (OpenAI-compatible, MiniMax, …) fetch model lists
  // live from the platform's /models endpoint, so their instances use the
  // same base-URL + remote-browse editing flow.
  const isDiscovery = isDiscoveryModelProvider(providerType);
  const isCompatibleLike = isDiscovery || isOllama;
  const isOpenRouter = providerType === "openrouter";
  const isShortlistBrowse = isShortlistBrowseProvider(providerType);
  const isCatalogShortlist = isCatalogShortlistProvider(providerType);

  const catalogModelsForType = useMemo(
    () => catalog.filter((model) => model.provider === providerType),
    [catalog, providerType]
  );

  const instanceModels = useMemo(
    () => catalog.filter((model) => model.providerId === instance.id),
    [catalog, instance.id]
  );

  const openManage = () => {
    setDialogError(null);
    setOpenRouterRouting(instance.openRouterRouting ?? {});

    setManageModels(seedManageModelRows(instance.customModels, instanceModels));

    setManageOpen(true);
  };

  const openEdit = () => {
    setDialogError(null);
    setEditLabel(instance.label);
    setEditBaseUrl(
      instance.baseUrl ??
        (isOllama
          ? defaultOllamaSetupBaseUrl(instance.hostMode ?? "local")
          : isDiscovery
            ? (defaultDiscoveryBaseUrl(providerType) ?? "")
            : "")
    );
    setEditWireApi(instance.wireApi ?? "chat");
    setManageModels(seedManageModelRows(instance.customModels, instanceModels));
    setEditOpen(true);
  };

  const runUpdate = async (
    request: Parameters<typeof onUpdate>[1],
    close?: () => void
  ) => {
    setBusy(true);
    setDialogError(null);
    onError(null);

    try {
      await onUpdate(instance.id, request);
      close?.();
    } catch (error) {
      const message = formatError(error);
      setDialogError(message);
      onError(message);
    } finally {
      setBusy(false);
    }
  };

  const handleReplaceKey = async () => {
    if (isXaiOAuth) {
      if (!xaiOAuth) {
        setDialogError("Sign in with Grok before saving.");

        return;
      }

      await runUpdate({ xaiOAuth }, () => {
        setReplaceKeyOpen(false);
        setXaiOAuth(null);
      });

      return;
    }

    if (isChatgpt) {
      if (!chatgptOAuth) {
        setDialogError("Sign in with ChatGPT before saving.");

        return;
      }

      await runUpdate({ chatgptOAuth }, () => {
        setReplaceKeyOpen(false);
        setChatgptOAuth(null);
      });

      return;
    }

    const nextError = validateApiKeyForProvider(apiKey, providerType, {
      ollamaHostMode: instance.hostMode ?? undefined,
    });

    if (nextError) {
      setDialogError(nextError);

      return;
    }

    await runUpdate({ apiKey: apiKey.trim() }, () => {
      setReplaceKeyOpen(false);
      setApiKey("");
      setShowApiKey(false);
    });
  };

  const handleDelete = async () => {
    setBusy(true);
    onError(null);

    try {
      await onDelete(instance.id);
      setDeleteOpen(false);
    } catch (error) {
      onError(formatError(error));
    } finally {
      setBusy(false);
    }
  };

  const saveCompatible = async () => {
    const displayNameError =
      providerType === "netra" ? null : validateDisplayNameInput(editLabel);

    const baseUrlError =
      providerType === "netra" ? null : validateBaseUrlInput(editBaseUrl);

    const modelsError = validateCustomModelsInput(manageModels);

    if (displayNameError || baseUrlError || modelsError) {
      setDialogError(displayNameError ?? baseUrlError ?? modelsError);

      return;
    }

    const request: UpdateProviderRequest = {
      customModels: normalizeModelListRows(manageModels),
    };

    if (providerType !== "netra") {
      request.baseUrl = editBaseUrl;
      request.label = editLabel;
    }

    if (isOllama) {
      request.hostMode = editBaseUrl.toLowerCase().includes("ollama.com")
        ? "cloud"
        : "local";
    }

    if (!isOllama && providerType !== "netra") {
      request.wireApi = editWireApi;
    }

    await runUpdate(request, () => setEditOpen(false));
  };

  const saveManageModels = async () => {
    const modelsError = isOpenRouter
      ? validateOpenRouterModelsInput(manageModels)
      : isShortlistBrowse
        ? validateShortlistCapabilityModelsInput(manageModels)
        : providerType === "opencode_go"
          ? validateOpenCodeGoModelsInput(manageModels)
          : validateCustomModelsInput(manageModels);

    if (modelsError) {
      setDialogError(modelsError);

      return;
    }

    const request: UpdateProviderRequest = {
      customModels: normalizeModelListRows(manageModels),
    };

    if (isOpenRouter) {
      request.openRouterRouting = openRouterRouting;
    }

    await runUpdate(request, () => setManageOpen(false));
  };

  const handleManageModelsChange = (rows: ModelListRow[]) => {
    setManageModels(rows);

    if (dialogError) {
      setDialogError(null);
    }
  };

  return {
    apiKey,
    busy,
    catalogModelsForType,
    chatgptOAuth,
    deleteOpen,
    dialogError,
    editBaseUrl,
    editLabel,
    editManageModels: manageModels,
    editOpen,
    editWireApi,
    handleDelete,
    handleManageModelsChange,
    handleReplaceKey,
    isCatalogShortlist,
    isChatgpt,
    isCompatibleLike,
    isOllama,
    isOpenRouter,
    isShortlistBrowse,
    isXaiOAuth,
    manageModels,
    manageOpen,
    openEdit,
    openManage,
    openRouterRouting,
    providerType,
    replaceKeyOpen,
    saveCompatible,
    saveManageModels,
    setApiKey,
    setChatgptOAuth,
    setDeleteOpen,
    setEditBaseUrl,
    setEditLabel,
    setEditOpen,
    setEditWireApi,
    setManageModels,
    setManageOpen,
    setOpenRouterRouting,
    setReplaceKeyOpen,
    setShowApiKey,
    setXaiOAuth,
    showApiKey,
    xaiOAuth,
  };
}
