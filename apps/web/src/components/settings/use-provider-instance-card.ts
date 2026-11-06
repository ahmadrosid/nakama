import type {
  CustomModelEntry,
  OpenRouterRoutingSettings,
  ProviderInstanceSummary,
  ProviderModelOption,
  UpdateProviderRequest,
  WireApi,
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
  onManage,
  onError,
}: {
  instance: ProviderInstanceSummary;
  catalog: ProviderModelOption[];
  onUpdate: (
    providerId: string,
    request: UpdateProviderRequest
  ) => Promise<void>;
  onDelete: (providerId: string) => Promise<void>;
  onManage?: (
    providerId: string,
    action: "clear" | "use-stored"
  ) => Promise<void>;
  onError: (error: string | null) => void;
}) {
  const [replaceKeyOpen, setReplaceKeyOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [editLabel, setEditLabel] = useState("");
  const [editBaseUrl, setEditBaseUrl] = useState("");

  // Edit marks the field at fault, as Add does.
  const [editFieldErrors, setEditFieldErrors] = useState<{
    baseUrl: string | null;
    displayName: string | null;
    models: string | null;
  }>({ baseUrl: null, displayName: null, models: null });

  const [editWireApi, setEditWireApi] = useState<WireApi>("chat");
  const [manageModels, setManageModels] = useState<ModelListRow[]>([]);

  const [openRouterRouting, setOpenRouterRouting] =
    useState<OpenRouterRoutingSettings>({});

  // What the dialog showed when it opened, to tell if the user changed it.
  const [openedSnapshot, setOpenedSnapshot] = useState("");
  const [openedRows, setOpenedRows] = useState<ModelListRow[]>([]);

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

    const rows = seedManageModelRows(instance.customModels, instanceModels);
    setManageModels(rows);
    setOpenedRows(rows);
    setOpenedSnapshot(
      editSnapshot(rows, "", "", "chat", instance.openRouterRouting ?? {})
    );
    setManageOpen(true);
  };

  const openEdit = () => {
    const baseUrl =
      instance.baseUrl ??
      (isOllama
        ? defaultOllamaSetupBaseUrl(instance.hostMode ?? "local")
        : isDiscovery
          ? (defaultDiscoveryBaseUrl(providerType) ?? "")
          : "");

    const wireApi = instance.wireApi ?? "chat";
    const rows = seedManageModelRows(instance.customModels, instanceModels);

    setDialogError(null);
    setEditFieldErrors({ baseUrl: null, displayName: null, models: null });
    setEditLabel(instance.label);
    setEditBaseUrl(baseUrl);
    setEditWireApi(wireApi);
    setManageModels(rows);
    setOpenedRows(rows);
    setOpenedSnapshot(editSnapshot(rows, instance.label, baseUrl, wireApi, {}));
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

  const reconnect = async (
    request: Pick<UpdateProviderRequest, "chatgptOAuth" | "xaiOAuth">
  ) => {
    await runUpdate(request, () => setReplaceKeyOpen(false));
  };

  const handleReplaceKey = async () => {
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

  const handleManageKey = async (action: "clear" | "use-stored") => {
    if (!onManage) {
      return;
    }

    setBusy(true);
    setDialogError(null);

    try {
      await onManage(instance.id, action);
      setReplaceKeyOpen(false);
    } catch (error) {
      setDialogError(formatError(error));
    } finally {
      setBusy(false);
    }
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
      setEditFieldErrors({
        baseUrl: baseUrlError,
        displayName: displayNameError,
        models: modelsError,
      });

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
    setEditFieldErrors((current) => ({ ...current, models: null }));

    if (dialogError) {
      setDialogError(null);
    }
  };

  const dirty =
    (manageOpen || editOpen) &&
    editSnapshot(
      manageModels,
      editOpen ? editLabel : "",
      editOpen ? editBaseUrl : "",
      editOpen ? editWireApi : "chat",
      editOpen ? {} : openRouterRouting
    ) !== openedSnapshot;

  return {
    apiKey,
    busy,
    catalogModelsForType,
    deleteOpen,
    dialogError,
    dirty,
    editBaseUrl,
    editFieldErrors,
    editLabel,
    editManageModels: manageModels,
    editOpen,
    editWireApi,
    handleDelete,
    handleManageKey,
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
    reconnect,
    replaceKeyOpen,
    saveCompatible,
    saveManageModels,
    saveSummary: dirty ? modelChangeSummary(openedRows, manageModels) : null,
    setApiKey,
    setDeleteOpen,
    setEditBaseUrl: (value: string) => {
      setEditBaseUrl(value);
      setEditFieldErrors((current) => ({ ...current, baseUrl: null }));
    },
    setEditLabel: (value: string) => {
      setEditLabel(value);
      setEditFieldErrors((current) => ({ ...current, displayName: null }));
    },
    setEditOpen,
    setEditWireApi,
    setManageModels,
    setManageOpen,
    setOpenRouterRouting,
    setReplaceKeyOpen,
    setShowApiKey,
    showApiKey,
  };
}

function editSnapshot(
  models: ModelListRow[],
  label: string,
  baseUrl: string,
  wireApi: WireApi,
  routing: OpenRouterRoutingSettings
): string {
  return JSON.stringify({ baseUrl, label, models, routing, wireApi });
}

// What Save will change, for example "2 added · 1 removed · default changed".
function modelChangeSummary(before: ModelListRow[], after: ModelListRow[]) {
  const beforeIds = new Set(before.map((row) => row.id.trim()));

  const afterIds = new Set(
    after.flatMap((row) => (row.id.trim() ? [row.id.trim()] : []))
  );

  const added = [...afterIds].filter((id) => !beforeIds.has(id)).length;
  const removed = [...beforeIds].filter((id) => !afterIds.has(id)).length;

  const defaultOf = (rows: ModelListRow[]) =>
    (rows.find((row) => row.default) ?? rows[0])?.id.trim();

  const parts = [
    added ? `${added} added` : null,
    removed ? `${removed} removed` : null,
    defaultOf(before) === defaultOf(after) ? null : "default changed",
  ].filter(Boolean);

  return parts.length ? parts.join(" · ") : "Unsaved changes";
}
