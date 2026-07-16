import type {
  ProviderInstanceSummary,
  ProviderModelOption,
  UpdateProviderRequest,
} from "@nakama/core/contract";
import { useMemo, useState } from "react";
import { isCatalogShortlistProvider } from "@/components/catalog-provider-model-fields.shared";
import { type ModelListRow } from "@/components/ModelListEditor";
import { normalizeModelListRows } from "@/components/model-list-editor.shared";
import { Button } from "@/components/ui/button";
import {
  ProviderCatalogManageDialog,
  ProviderCompatibleEditDialog,
  ProviderCompatibleManageDialog,
  ProviderOpenRouterManageDialog,
  ProviderReplaceKeyDialog,
} from "@/components/settings/provider-instance-dialogs";
import { formatError } from "@/lib/client";
import {
  formatProviderLabel,
  type SelectedProvider,
  validateApiKeyForProvider,
  validateBaseUrlInput,
  validateCustomModelsInput,
  validateDisplayNameInput,
  validateOpenCodeGoModelsInput,
  validateOpenRouterModelsInput,
} from "@/lib/models";
import {
  seedManageModelRows,
  seedOpenRouterManageModelRows,
} from "@/components/settings/provider-settings-seed";

export function ProviderInstanceCard({
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
  const [editLabel, setEditLabel] = useState(instance.label);
  const [editBaseUrl, setEditBaseUrl] = useState(instance.baseUrl ?? "");
  const [manageModels, setManageModels] = useState<ModelListRow[]>([]);

  const providerType = instance.type as SelectedProvider;
  const isCompatible = providerType === "openai_compatible";
  const isOpenRouter = providerType === "openrouter";
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

  return (
    <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium text-foreground">{instance.label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
        {isCompatible && instance.baseUrl ? (
          <p className="font-mono text-[11px] text-foreground/80">{instance.baseUrl}</p>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {isCompatible ? (
          <Button type="button" size="sm" variant="outline" onClick={() => setEditOpen(true)}>
            Edit
          </Button>
        ) : null}
        {isCompatible || isOpenRouter || isCatalogShortlist ? (
          <Button type="button" size="sm" variant="outline" onClick={openManage}>
            Manage
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="outline" onClick={() => setReplaceKeyOpen(true)}>
          {instance.hasApiKey ? "Update key" : "Add key"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void handleDelete()}
        >
          Remove
        </Button>
      </div>

      <ProviderReplaceKeyDialog
        open={replaceKeyOpen}
        instance={instance}
        providerType={providerType}
        apiKey={apiKey}
        showApiKey={showApiKey}
        busy={busy}
        dialogError={dialogError}
        onOpenChange={setReplaceKeyOpen}
        onApiKeyChange={setApiKey}
        onToggleShowApiKey={() => setShowApiKey((current) => !current)}
        onSave={() => void handleReplaceKey()}
      />

      {isCompatible ? (
        <ProviderCompatibleEditDialog
          open={editOpen}
          busy={busy}
          dialogError={dialogError}
          editLabel={editLabel}
          editBaseUrl={editBaseUrl}
          manageModels={
            manageModels.length
              ? manageModels
              : seedManageModelRows(instance.customModels, instanceModels)
          }
          onOpenChange={setEditOpen}
          onDisplayNameChange={setEditLabel}
          onBaseUrlChange={setEditBaseUrl}
          onCustomModelsChange={setManageModels}
          onSave={() => void saveCompatible()}
        />
      ) : null}

      {isCompatible ? (
        <ProviderCompatibleManageDialog
          open={manageOpen}
          busy={busy}
          dialogError={dialogError}
          instance={instance}
          manageModels={manageModels}
          onOpenChange={setManageOpen}
          onCustomModelsChange={setManageModels}
          onSave={() => void saveCompatible()}
        />
      ) : null}

      {isOpenRouter ? (
        <ProviderOpenRouterManageDialog
          open={manageOpen}
          busy={busy}
          dialogError={dialogError}
          manageModels={manageModels}
          onOpenChange={setManageOpen}
          onCustomModelsChange={handleManageModelsChange}
          onSave={() => void saveOpenRouter()}
        />
      ) : null}

      {isCatalogShortlist ? (
        <ProviderCatalogManageDialog
          open={manageOpen}
          busy={busy}
          dialogError={dialogError}
          providerType={providerType}
          instanceId={instance.id}
          manageModels={manageModels}
          catalogModelsForType={catalogModelsForType}
          onOpenChange={setManageOpen}
          onCustomModelsChange={handleManageModelsChange}
          onSave={() => void saveCatalogShortlist()}
        />
      ) : null}
    </div>
  );
}
