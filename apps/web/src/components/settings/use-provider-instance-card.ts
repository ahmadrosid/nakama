import type {
  ProviderInstanceSummary,
  ProviderModelOption,
  UpdateProviderRequest,
} from "@nakama/core/contract";
import { useMemo, useState } from "react";
import { isCatalogShortlistProvider } from "@/components/catalog-provider-model-fields.shared";
import { type ModelListRow } from "@/components/ModelListEditor";
import { normalizeModelListRows } from "@/components/model-list-editor.shared";
import {
  seedCerebrasManageModelRows,
  seedManageModelRows,
  seedOpenRouterManageModelRows,
} from "@/components/settings/provider-settings-seed";
import { formatError } from "@/lib/client";
import {
  formatProviderLabel,
  type SelectedProvider,
  validateApiKeyForProvider,
  validateBaseUrlInput,
  validateCerebrasModelsInput,
  validateCustomModelsInput,
  validateDisplayNameInput,
  validateOpenCodeGoModelsInput,
  validateOpenRouterModelsInput,
} from "@/lib/models";

export function useProviderInstanceCard({
  instance,
  catalog,
  onUpdate,
  onDelete,
  onError,
}: {
  instance: ProviderInstanceSummary;
  catalog: ProviderModelOption[];
  onUpdate: (providerId: string, request: UpdateProviderRequest) => Promise<void>;
  onDelete: (providerId: string) => Promise<void>;
  onError: (error: string | null) => void;
}) {
  const [replaceKeyOpen, setReplaceKeyOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [editLabel, setEditLabel] = useState("");
  const [editBaseUrl, setEditBaseUrl] = useState("");
  const [manageModels, setManageModels] = useState<ModelListRow[]>([]);

  const providerType = instance.type as SelectedProvider;
  const isCompatible = providerType === "openai_compatible";
  const isOpenRouter = providerType === "openrouter";
  const isCerebras = providerType === "cerebras";
  const isCatalogShortlist = isCatalogShortlistProvider(providerType);

  const catalogModelsForType = useMemo(
    () => catalog.filter((model) => model.provider === providerType),
    [catalog, providerType],
  );

  const instanceModels = useMemo(
    () => catalog.filter((model) => model.providerId === instance.id),
    [catalog, instance.id],
  );

  const description = useMemo(() => {
    const parts = [formatProviderLabel(providerType, instance.label)];

    if (instance.hasApiKey) {
      parts.push("API key saved");
    }

    parts.push(`${instance.modelCount} models`);
    return parts.join(" · ");
  }, [instance.hasApiKey, instance.label, instance.modelCount, providerType]);

  const openManage = () => {
    setDialogError(null);

    if (isCompatible) {
      setManageModels(seedManageModelRows(instance.customModels, instanceModels));
    } else if (isOpenRouter) {
      setManageModels(
        seedOpenRouterManageModelRows(
          instance.customModels,
          null,
          instanceModels[0]?.name,
        ),
      );
    } else if (isCerebras) {
      setManageModels(
        seedCerebrasManageModelRows(
          instance.customModels,
          null,
          instanceModels[0]?.name,
        ),
      );
    } else if (isCatalogShortlist) {
      setManageModels(
        seedManageModelRows(
          instance.customModels,
          instance.customModels?.length ? instanceModels : [],
        ),
      );
    }

    setManageOpen(true);
  };

  const openEdit = () => {
    setEditLabel(instance.label);
    setEditBaseUrl(instance.baseUrl ?? "");
    setDialogError(null);
    setEditOpen(true);
  };

  const runUpdate = async (
    request: Parameters<typeof onUpdate>[1],
    close?: () => void,
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
    const nextError = validateApiKeyForProvider(apiKey, providerType);

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
    } catch (error) {
      onError(formatError(error));
    } finally {
      setBusy(false);
    }
  };

  const saveCompatible = async () => {
    const displayNameError = validateDisplayNameInput(editLabel);
    const baseUrlError = isCompatible ? validateBaseUrlInput(editBaseUrl) : null;
    const modelsError = isCompatible ? validateCustomModelsInput(manageModels) : null;

    if (displayNameError || baseUrlError || modelsError) {
      setDialogError(displayNameError ?? baseUrlError ?? modelsError);
      return;
    }

    await runUpdate(
      {
        label: editLabel,
        baseUrl: editBaseUrl,
        customModels: normalizeModelListRows(manageModels),
      },
      () => {
        setEditOpen(false);
        setManageOpen(false);
      },
    );
  };

  const saveOpenRouter = async () => {
    const modelsError = validateOpenRouterModelsInput(manageModels);

    if (modelsError) {
      setDialogError(modelsError);
      return;
    }

    await runUpdate(
      { customModels: normalizeModelListRows(manageModels) },
      () => setManageOpen(false),
    );
  };

  const saveCerebras = async () => {
    const modelsError = validateCerebrasModelsInput(manageModels);

    if (modelsError) {
      setDialogError(modelsError);
      return;
    }

    await runUpdate(
      { customModels: normalizeModelListRows(manageModels) },
      () => setManageOpen(false),
    );
  };

  const saveCatalogShortlist = async () => {
    const modelsError =
      providerType === "opencode_go"
        ? validateOpenCodeGoModelsInput(manageModels)
        : validateCustomModelsInput(manageModels);

    if (modelsError) {
      setDialogError(modelsError);
      return;
    }

    await runUpdate(
      { customModels: normalizeModelListRows(manageModels) },
      () => setManageOpen(false),
    );
  };

  const handleManageModelsChange = (rows: ModelListRow[]) => {
    setManageModels(rows);
    if (dialogError) {
      setDialogError(null);
    }
  };

  const editManageModels = manageModels.length
    ? manageModels
    : seedManageModelRows(instance.customModels, instanceModels);

  return {
    providerType,
    isCompatible,
    isOpenRouter,
    isCerebras,
    isCatalogShortlist,
    catalogModelsForType,
    description,
    busy,
    dialogError,
    replaceKeyOpen,
    setReplaceKeyOpen,
    editOpen,
    setEditOpen,
    manageOpen,
    setManageOpen,
    apiKey,
    setApiKey,
    showApiKey,
    setShowApiKey,
    editLabel,
    setEditLabel,
    editBaseUrl,
    setEditBaseUrl,
    manageModels,
    setManageModels,
    editManageModels,
    openManage,
    openEdit,
    handleReplaceKey,
    handleDelete,
    saveCompatible,
    saveOpenRouter,
    saveCerebras,
    saveCatalogShortlist,
    handleManageModelsChange,
  };
}
