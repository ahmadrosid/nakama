import type {
  ProviderInstanceSummary,
  ProviderModelOption,
  UpdateProviderRequest,
} from "@nakama/core/contract";
import { useMemo, useState } from "react";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { OpenRouterProviderModelFields } from "@/components/OpenRouterProviderModelFields";
import {
  CatalogProviderModelFields,
  isCatalogShortlistProvider,
} from "@/components/CatalogProviderModelFields";
import { CustomProviderFields } from "@/components/CustomProviderFields";
import { normalizeModelListRows, type ModelListRow } from "@/components/ModelListEditor";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { formatError } from "@/lib/client";
import {
  apiKeyPlaceholder,
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
} from "./provider-settings-shared";

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

      <Dialog open={replaceKeyOpen} onOpenChange={setReplaceKeyOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {instance.hasApiKey ? "Update API key" : "Add API key"} for {instance.label}
            </DialogTitle>
          </DialogHeader>
          <InputGroup>
            <InputGroupInput
              type={showApiKey ? "text" : "password"}
              autoComplete="off"
              placeholder={apiKeyPlaceholder(providerType)}
              value={apiKey}
              disabled={busy}
              onChange={(event) => setApiKey(event.target.value)}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-sm"
                aria-label={showApiKey ? "Hide API key" : "Show API key"}
                onClick={() => setShowApiKey((current) => !current)}
              >
                {showApiKey ? <EyeOffIcon /> : <EyeIcon />}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          {dialogError ? (
            <p className="text-sm text-destructive" role="alert">
              {dialogError}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setReplaceKeyOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={busy || !apiKey.trim()} onClick={() => void handleReplaceKey()}>
              {busy ? <Spinner className="mr-2" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isCompatible ? (
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent className="w-[min(96vw,56rem)] sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>Edit provider</DialogTitle>
            </DialogHeader>
            <CustomProviderFields
              displayName={editLabel}
              baseUrl={editBaseUrl}
              apiKey=""
              customModels={manageModels.length ? manageModels : seedManageModelRows(instance.customModels, instanceModels)}
              disabled={busy}
              showThinkingToggle
              displayNameError={null}
              baseUrlError={null}
              modelsError={null}
              onDisplayNameChange={setEditLabel}
              onBaseUrlChange={setEditBaseUrl}
              onCustomModelsChange={setManageModels}
            />
            {dialogError ? (
              <p className="text-sm text-destructive" role="alert">
                {dialogError}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" disabled={busy} onClick={() => void saveCompatible()}>
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {isCompatible ? (
        <Dialog open={manageOpen} onOpenChange={setManageOpen}>
          <DialogContent className="w-[min(96vw,56rem)] sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>Manage models</DialogTitle>
            </DialogHeader>
            <CustomProviderFields
              displayName={instance.label}
              baseUrl={instance.baseUrl ?? ""}
              apiKey=""
              customModels={manageModels}
              disabled={busy}
              showThinkingToggle
              displayNameError={null}
              baseUrlError={null}
              modelsError={null}
              onDisplayNameChange={() => {}}
              onBaseUrlChange={() => {}}
              onCustomModelsChange={setManageModels}
            />
            {dialogError ? (
              <p className="text-sm text-destructive" role="alert">
                {dialogError}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" disabled={busy} onClick={() => void saveCompatible()}>
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {isOpenRouter ? (
        <Dialog open={manageOpen} onOpenChange={setManageOpen}>
          <DialogContent className="w-[min(96vw,56rem)] sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>Manage models</DialogTitle>
              <DialogDescription>Edit the shortlist available in chat for this provider.</DialogDescription>
            </DialogHeader>
            <OpenRouterProviderModelFields
              customModels={manageModels}
              disabled={busy}
              modelsError={dialogError}
              onCustomModelsChange={(rows) => {
                setManageModels(rows);
                if (dialogError) {
                  setDialogError(null);
                }
              }}
            />
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setManageOpen(false)}>
                Cancel
              </Button>
              <Button type="button" disabled={busy} onClick={() => void saveOpenRouter()}>
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {isCatalogShortlist ? (
        <Dialog open={manageOpen} onOpenChange={setManageOpen}>
          <DialogContent className="w-[min(96vw,56rem)] sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>Manage models</DialogTitle>
              <DialogDescription>Edit the shortlist available in chat for this provider.</DialogDescription>
            </DialogHeader>
            <CatalogProviderModelFields
              provider={providerType}
              providerInstanceId={instance.id}
              customModels={manageModels}
              catalogModels={catalogModelsForType}
              disabled={busy}
              modelsError={dialogError}
              onCustomModelsChange={(rows) => {
                setManageModels(rows);
                if (dialogError) {
                  setDialogError(null);
                }
              }}
            />
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setManageOpen(false)}>
                Cancel
              </Button>
              <Button type="button" disabled={busy} onClick={() => void saveCatalogShortlist()}>
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
