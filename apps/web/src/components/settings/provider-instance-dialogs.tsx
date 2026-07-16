import type {
  ProviderInstanceSummary,
  ProviderModelOption,
} from "@nakama/core/contract";
import type { ModelListRow } from "@/components/ModelListEditor";
import { OpenRouterProviderModelFields } from "@/components/OpenRouterProviderModelFields";
import { CatalogProviderModelFields } from "@/components/CatalogProviderModelFields";
import { CustomProviderFields } from "@/components/CustomProviderFields";
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
import { apiKeyPlaceholder, type SelectedProvider } from "@/lib/models";
import type { CatalogShortlistProvider } from "@/components/catalog-provider-model-fields.shared";
import { EyeIcon, EyeOffIcon } from "lucide-react";

export function ProviderReplaceKeyDialog({
  open,
  instance,
  providerType,
  apiKey,
  showApiKey,
  busy,
  dialogError,
  onOpenChange,
  onApiKeyChange,
  onToggleShowApiKey,
  onSave,
}: {
  open: boolean;
  instance: ProviderInstanceSummary;
  providerType: SelectedProvider;
  apiKey: string;
  showApiKey: boolean;
  busy: boolean;
  dialogError: string | null;
  onOpenChange: (open: boolean) => void;
  onApiKeyChange: (value: string) => void;
  onToggleShowApiKey: () => void;
  onSave: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
        {dialogError ? (
          <p className="text-sm text-destructive" role="alert">
            {dialogError}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={busy || !apiKey.trim()} onClick={onSave}>
            {busy ? <Spinner className="mr-2" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProviderCompatibleEditDialog({
  open,
  busy,
  dialogError,
  editLabel,
  editBaseUrl,
  manageModels,
  onOpenChange,
  onDisplayNameChange,
  onBaseUrlChange,
  onCustomModelsChange,
  onSave,
}: {
  open: boolean;
  busy: boolean;
  dialogError: string | null;
  editLabel: string;
  editBaseUrl: string;
  manageModels: ModelListRow[];
  onOpenChange: (open: boolean) => void;
  onDisplayNameChange: (value: string) => void;
  onBaseUrlChange: (value: string) => void;
  onCustomModelsChange: (rows: ModelListRow[]) => void;
  onSave: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(96vw,56rem)] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Edit provider</DialogTitle>
        </DialogHeader>
        <CustomProviderFields
          displayName={editLabel}
          baseUrl={editBaseUrl}
          apiKey=""
          customModels={manageModels}
          disabled={busy}
          showThinkingToggle
          displayNameError={null}
          baseUrlError={null}
          modelsError={null}
          onDisplayNameChange={onDisplayNameChange}
          onBaseUrlChange={onBaseUrlChange}
          onCustomModelsChange={onCustomModelsChange}
        />
        {dialogError ? (
          <p className="text-sm text-destructive" role="alert">
            {dialogError}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" disabled={busy} onClick={onSave}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProviderCompatibleManageDialog({
  open,
  busy,
  dialogError,
  instance,
  manageModels,
  onOpenChange,
  onCustomModelsChange,
  onSave,
}: {
  open: boolean;
  busy: boolean;
  dialogError: string | null;
  instance: ProviderInstanceSummary;
  manageModels: ModelListRow[];
  onOpenChange: (open: boolean) => void;
  onCustomModelsChange: (rows: ModelListRow[]) => void;
  onSave: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
          onCustomModelsChange={onCustomModelsChange}
        />
        {dialogError ? (
          <p className="text-sm text-destructive" role="alert">
            {dialogError}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" disabled={busy} onClick={onSave}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProviderOpenRouterManageDialog({
  open,
  busy,
  dialogError,
  manageModels,
  onOpenChange,
  onCustomModelsChange,
  onSave,
}: {
  open: boolean;
  busy: boolean;
  dialogError: string | null;
  manageModels: ModelListRow[];
  onOpenChange: (open: boolean) => void;
  onCustomModelsChange: (rows: ModelListRow[]) => void;
  onSave: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(96vw,56rem)] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Manage models</DialogTitle>
          <DialogDescription>Edit the shortlist available in chat for this provider.</DialogDescription>
        </DialogHeader>
        <OpenRouterProviderModelFields
          customModels={manageModels}
          disabled={busy}
          modelsError={dialogError}
          onCustomModelsChange={onCustomModelsChange}
        />
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={busy} onClick={onSave}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProviderCatalogManageDialog({
  open,
  busy,
  dialogError,
  providerType,
  instanceId,
  manageModels,
  catalogModelsForType,
  onOpenChange,
  onCustomModelsChange,
  onSave,
}: {
  open: boolean;
  busy: boolean;
  dialogError: string | null;
  providerType: CatalogShortlistProvider;
  instanceId: string;
  manageModels: ModelListRow[];
  catalogModelsForType: ProviderModelOption[];
  onOpenChange: (open: boolean) => void;
  onCustomModelsChange: (rows: ModelListRow[]) => void;
  onSave: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(96vw,56rem)] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Manage models</DialogTitle>
          <DialogDescription>Edit the shortlist available in chat for this provider.</DialogDescription>
        </DialogHeader>
        <CatalogProviderModelFields
          provider={providerType}
          providerInstanceId={instanceId}
          customModels={manageModels}
          catalogModels={catalogModelsForType}
          disabled={busy}
          modelsError={dialogError}
          onCustomModelsChange={onCustomModelsChange}
        />
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={busy} onClick={onSave}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
