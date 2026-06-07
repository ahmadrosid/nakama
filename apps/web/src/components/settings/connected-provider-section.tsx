import type { ProviderModelOption } from "@tinyclaw/core/contract";
import { useEffect, useState } from "react";
import { useReplaceApiKeyForm } from "@/hooks/use-replace-api-key-form";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { OpenRouterProviderModelFields } from "@/components/OpenRouterProviderModelFields";
import {
  CustomCompatibleProviderFields,
  toCustomModelEntries,
} from "@/components/CustomCompatibleProviderFields";
import type { ModelListRow } from "@/components/ModelListEditor";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import type { useAppContext } from "@/context/app-context";
import { formatError } from "@/lib/client";
import {
  apiKeyPlaceholder,
  buildConfigureProviderRequest,
  formatProviderLabel,
  type SelectedProvider,
  validateOpenRouterModelsInput,
} from "@/lib/models";
import {
  seedManageModelRows,
  seedOpenRouterManageModelRows,
  SettingsRow,
} from "./provider-settings-shared";

export function ConnectedProviderSection({
  models,
  configureProvider,
  configuredModels,
  formError,
  onFormError,
  onReplaceKeyOpen,
  onReplaceKeySuccess,
}: {
  models: NonNullable<ReturnType<typeof useAppContext>["models"]>;
  configureProvider: ReturnType<typeof useAppContext>["configureProvider"];
  configuredModels: ProviderModelOption[];
  formError: string | null;
  onFormError: (error: string | null) => void;
  onReplaceKeyOpen?: () => void;
  onReplaceKeySuccess?: () => void;
}) {
  const {
    open: replaceKeyOpen,
    apiKey,
    showApiKey,
    error: apiKeyError,
    busy: replaceKeyBusy,
    openForm: onOpenReplaceKey,
    reset: onCancelReplaceKey,
    handleBlur: onApiKeyBlur,
    handleChange: onApiKeyChange,
    handleSubmit: onSubmitReplaceKey,
    toggleShowApiKey: onToggleShowApiKey,
  } = useReplaceApiKeyForm({
    models,
    configureProvider,
    onFormError,
    onSuccess: onReplaceKeySuccess,
  });
  const currentProvider = models.provider as SelectedProvider;
  const isCompatible = currentProvider === "openai_compatible";
  const isOpenRouter = currentProvider === "openrouter";
  const [editOpen, setEditOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [activeModelDraft, setActiveModelDraft] = useState("");
  const [editDisplayName, setEditDisplayName] = useState(models.displayName ?? "");
  const [editBaseUrl, setEditBaseUrl] = useState(models.baseUrl ?? "");
  const [manageModels, setManageModels] = useState<ModelListRow[]>(
    (models.customModels ?? []).map((model) => ({
      id: model.id,
      name: model.name ?? model.id,
      default: model.default,
      inputPerMillionUsd: model.inputPerMillionUsd,
      outputPerMillionUsd: model.outputPerMillionUsd,
    })),
  );
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const currentModelName =
    configuredModels.find((model) => model.id === models.currentModel)?.name ??
    models.currentModel;

  useEffect(() => {
    if (isCompatible) {
      setManageModels(seedManageModelRows(models.customModels, configuredModels));
    } else if (isOpenRouter) {
      setManageModels(
        seedOpenRouterManageModelRows(
          models.customModels,
          models.currentModel,
          currentModelName,
        ),
      );
    }
  }, [
    models.customModels,
    models.currentModel,
    configuredModels,
    isCompatible,
    isOpenRouter,
    currentModelName,
  ]);

  const saveCompatibleConfig = async (patch: {
    displayName?: string;
    baseUrl?: string;
    customModels?: ReturnType<typeof toCustomModelEntries>;
  }) => {
    setDialogBusy(true);
    setDialogError(null);

    try {
      await configureProvider(
        buildConfigureProviderRequest({
          apiKey: "",
          provider: "openai_compatible",
          model: models.currentModel ?? undefined,
          displayName: patch.displayName ?? models.displayName ?? "",
          baseUrl: patch.baseUrl ?? models.baseUrl ?? "",
          customModels: patch.customModels ?? models.customModels,
        }),
      );
      setEditOpen(false);
      setManageOpen(false);
    } catch (error) {
      setDialogError(formatError(error));
    } finally {
      setDialogBusy(false);
    }
  };

  const openOpenRouterManage = () => {
    setDialogError(null);
    setManageModels(
      seedOpenRouterManageModelRows(
        models.customModels,
        models.currentModel,
        currentModelName,
      ),
    );
    setActiveModelDraft(models.currentModel ?? "");
    setManageOpen(true);
  };

  const saveOpenRouterConfig = async () => {
    const modelsError = validateOpenRouterModelsInput(manageModels);
    if (modelsError) {
      setDialogError(modelsError);
      return;
    }

    const modelIds = manageModels.map((row) => row.id.trim()).filter(Boolean);
    const activeModel = activeModelDraft.trim();

    if (!activeModel || !modelIds.includes(activeModel)) {
      setDialogError("Choose an active model from your list.");
      return;
    }

    setDialogBusy(true);
    setDialogError(null);

    try {
      await configureProvider(
        buildConfigureProviderRequest({
          apiKey: "",
          provider: "openrouter",
          model: activeModel,
          customModels: toCustomModelEntries(manageModels),
        }),
      );
      setManageOpen(false);
    } catch (error) {
      setDialogError(formatError(error));
    } finally {
      setDialogBusy(false);
    }
  };

  return (
    <div className="divide-y divide-border">
      <div className="px-4 py-3">
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-medium text-foreground">Provider</p>
          <p className="text-xs text-muted-foreground">
            {formatProviderLabel(currentProvider, models.displayName)} · {currentModelName}
          </p>
        </div>
      </div>

      {isCompatible ? (
        <SettingsRow label="Endpoint" description={models.baseUrl ?? "—"}>
          <Button type="button" size="sm" variant="outline" onClick={() => setEditOpen(true)}>
            Edit
          </Button>
        </SettingsRow>
      ) : null}

      {isCompatible ? (
        <SettingsRow
          label="Models"
          description={`${models.customModels?.length ?? 0} models configured`}
        >
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setDialogError(null);
              setManageModels(seedManageModelRows(models.customModels, configuredModels));
              setManageOpen(true);
            }}
          >
            Manage
          </Button>
        </SettingsRow>
      ) : null}

      {isOpenRouter ? (
        <SettingsRow
          label="Model"
          description={
            <>
              <span className="block font-mono text-[11px] text-foreground/90">
                {models.currentModel}
              </span>
              <span className="mt-0.5 block">
                Chat history resets when you change models
              </span>
            </>
          }
        >
          <Button type="button" size="sm" variant="outline" onClick={openOpenRouterManage}>
            Manage
          </Button>
        </SettingsRow>
      ) : null}

      <SettingsRow label="API key" description="Saved on the server">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onOpenReplaceKey(onReplaceKeyOpen)}
        >
          Replace key
        </Button>
      </SettingsRow>

      <Dialog
        open={replaceKeyOpen}
        onOpenChange={(open) => {
          if (!open) {
            onCancelReplaceKey();
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <form className="space-y-4" onSubmit={(event) => void onSubmitReplaceKey(event)}>
            <DialogHeader>
              <DialogTitle>
                Replace API key
                {isCompatible && models.displayName ? ` for ${models.displayName}` : ""}
              </DialogTitle>
              <DialogDescription>
                Paste a new key from your{" "}
                {formatProviderLabel(currentProvider, models.displayName)} dashboard. The current
                model stays the same.
              </DialogDescription>
            </DialogHeader>

            <InputGroup>
              <InputGroupInput
                id="replace-api-key"
                type={showApiKey ? "text" : "password"}
                autoComplete="off"
                placeholder={apiKeyPlaceholder(currentProvider)}
                value={apiKey}
                disabled={replaceKeyBusy}
                aria-invalid={apiKeyError != null}
                aria-describedby={apiKeyError ? "replace-api-key-error" : undefined}
                onBlur={onApiKeyBlur}
                onChange={(event) => onApiKeyChange(event.target.value)}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  size="icon-sm"
                  aria-label={showApiKey ? "Hide API key" : "Show API key"}
                  onClick={onToggleShowApiKey}
                >
                  {showApiKey ? <EyeOffIcon /> : <EyeIcon />}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>

            {apiKeyError ? (
              <p id="replace-api-key-error" className="text-sm text-destructive" role="alert">
                {apiKeyError}
              </p>
            ) : null}
            {formError ? (
              <p className="text-sm text-destructive" role="alert">
                {formError}
              </p>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={replaceKeyBusy}
                onClick={onCancelReplaceKey}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={replaceKeyBusy || !apiKey.trim()}>
                {replaceKeyBusy ? (
                  <>
                    <Spinner className="mr-2" />
                    Saving…
                  </>
                ) : (
                  "Save key"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {isCompatible ? (
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent className="w-[min(96vw,56rem)] sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>Edit provider</DialogTitle>
            </DialogHeader>
            <CustomCompatibleProviderFields
              displayName={editDisplayName}
              baseUrl={editBaseUrl}
              apiKey=""
              customModels={manageModels}
              disabled={dialogBusy}
              displayNameError={null}
              baseUrlError={null}
              modelsError={null}
              onDisplayNameChange={setEditDisplayName}
              onBaseUrlChange={setEditBaseUrl}
              onCustomModelsChange={setManageModels}
            />
            {dialogError ? (
              <p className="text-sm text-destructive" role="alert">
                {dialogError}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                disabled={dialogBusy}
                onClick={() =>
                  void saveCompatibleConfig({
                    displayName: editDisplayName,
                    baseUrl: editBaseUrl,
                    customModels: toCustomModelEntries(manageModels),
                  })
                }
              >
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
            <CustomCompatibleProviderFields
              displayName={models.displayName ?? ""}
              baseUrl={models.baseUrl ?? ""}
              apiKey=""
              customModels={manageModels}
              disabled={dialogBusy}
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
              <Button
                type="button"
                disabled={dialogBusy}
                onClick={() =>
                  void saveCompatibleConfig({
                    customModels: toCustomModelEntries(manageModels),
                  })
                }
              >
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {isOpenRouter ? (
        <Dialog
          open={manageOpen}
          onOpenChange={(open) => {
            setManageOpen(open);
            if (!open) {
              setDialogError(null);
            }
          }}
        >
          <DialogContent className="w-[min(96vw,56rem)] sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>Manage model</DialogTitle>
              <DialogDescription>
                Choose the active model and edit your shortlist. Chat history resets when the active
                model changes.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <FormField id="openrouter-active-model" label="Active model">
                <Select
                  value={
                    manageModels.some((row) => row.id.trim() === activeModelDraft)
                      ? activeModelDraft
                      : ""
                  }
                  disabled={
                    dialogBusy ||
                    manageModels.every((row) => !row.id.trim())
                  }
                  onValueChange={(value) => {
                    setActiveModelDraft(value != null ? String(value) : "");
                    if (dialogError) {
                      setDialogError(null);
                    }
                  }}
                >
                  <SelectTrigger id="openrouter-active-model" className="w-full">
                    <SelectValue placeholder="Select active model" />
                  </SelectTrigger>
                  <SelectContent>
                    {manageModels
                      .filter((row) => row.id.trim())
                      .map((row) => (
                        <SelectItem key={row.id.trim()} value={row.id.trim()}>
                          {row.name?.trim() || row.id.trim()}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </FormField>
              <OpenRouterProviderModelFields
                customModels={manageModels}
                disabled={dialogBusy}
                modelsError={dialogError}
                onBrowseModelAdded={(row) => setActiveModelDraft(row.id)}
                onCustomModelsChange={(rows) => {
                  setManageModels(rows);
                  const ids = rows.map((row) => row.id.trim()).filter(Boolean);
                  if (activeModelDraft.trim() && !ids.includes(activeModelDraft.trim())) {
                    setActiveModelDraft(ids[0] ?? "");
                  }
                  if (dialogError) {
                    setDialogError(null);
                  }
                }}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={dialogBusy} onClick={() => setManageOpen(false)}>
                Cancel
              </Button>
              <Button type="button" disabled={dialogBusy} onClick={() => void saveOpenRouterConfig()}>
                {dialogBusy ? (
                  <>
                    <Spinner className="mr-2" />
                    Saving…
                  </>
                ) : (
                  "Save"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
