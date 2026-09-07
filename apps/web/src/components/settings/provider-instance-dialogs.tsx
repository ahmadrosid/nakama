import type {
  ChatgptOAuthCredentials,
  ProviderInstanceSummary,
  WireApi,
  XaiOAuthCredentials,
} from "@nakama/core/contract";
import { ViewIcon, ViewOffIcon } from "hugeicons-react";
import type { ReactNode } from "react";
import {
  ChatgptSignInPanel,
  XaiSignInPanel,
} from "@/components/ChatgptSignInPanel";
import { CustomProviderFields } from "@/components/CustomProviderFields";
import type { ModelListRow } from "@/components/ModelListEditor";
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

export function ProviderReplaceKeyDialog({
  open,
  instance,
  providerType,
  apiKey,
  showApiKey,
  xaiOAuth = null,
  onXaiOAuthChange,
  chatgptOAuth = null,
  busy,
  dialogError,
  onOpenChange,
  onApiKeyChange,
  onChatgptOAuthChange,
  onToggleShowApiKey,
  onSave,
}: {
  open: boolean;
  instance: ProviderInstanceSummary;
  providerType: SelectedProvider;
  apiKey: string;
  showApiKey: boolean;
  xaiOAuth?: XaiOAuthCredentials | null;
  onXaiOAuthChange: (oauth: XaiOAuthCredentials | null) => void;
  chatgptOAuth?: ChatgptOAuthCredentials | null;
  busy: boolean;
  dialogError: string | null;
  onOpenChange: (open: boolean) => void;
  onApiKeyChange: (value: string) => void;
  onChatgptOAuthChange: (oauth: ChatgptOAuthCredentials | null) => void;
  onToggleShowApiKey: () => void;
  onSave: () => void;
}) {
  const isXaiOAuth = providerType === "xai_oauth";
  const isChatgpt = providerType === "chatgpt";

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isChatgpt || isXaiOAuth
              ? `Reconnect ${instance.label}`
              : `${instance.hasApiKey ? "Update API key" : "Add API key"} for ${instance.label}`}
          </DialogTitle>
        </DialogHeader>
        {isXaiOAuth ? (
          <XaiSignInPanel
            disabled={busy}
            oauth={xaiOAuth}
            onOAuthChange={onXaiOAuthChange}
          />
        ) : isChatgpt ? (
          <ChatgptSignInPanel
            disabled={busy}
            oauth={chatgptOAuth}
            onOAuthChange={onChatgptOAuthChange}
          />
        ) : (
          <InputGroup>
            <InputGroupInput
              autoComplete="off"
              disabled={busy}
              onChange={(event) => onApiKeyChange(event.target.value)}
              placeholder={apiKeyPlaceholder(providerType)}
              type={showApiKey ? "text" : "password"}
              value={apiKey}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                aria-label={showApiKey ? "Hide API key" : "Show API key"}
                onClick={onToggleShowApiKey}
                size="icon-sm"
              >
                {showApiKey ? <ViewOffIcon /> : <ViewIcon />}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        )}
        {dialogError ? (
          <p className="text-destructive text-sm" role="alert">
            {dialogError}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            disabled={busy}
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            disabled={
              busy ||
              (isXaiOAuth
                ? !xaiOAuth
                : isChatgpt
                  ? !chatgptOAuth
                  : !apiKey.trim())
            }
            onClick={onSave}
            type="button"
          >
            {busy ? <Spinner className="mr-2" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProviderModelsDialogShell({
  open,
  busy,
  dialogError,
  title,
  description,
  onOpenChange,
  onSave,
  children,
}: {
  open: boolean;
  busy: boolean;
  dialogError: string | null;
  title: string;
  description?: string;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="w-[min(96vw,56rem)] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>
        {children}
        {dialogError ? (
          <p className="text-destructive text-sm" role="alert">
            {dialogError}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            disabled={busy}
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button disabled={busy} onClick={onSave} type="button">
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
  apiKey = "",
  browseSource = "remote",
  remoteProvider = "openai_compatible",
  providerInstanceId,
  hostMode,
  browseLabel,
  onOpenChange,
  onDisplayNameChange,
  onBaseUrlChange,
  onCustomModelsChange,
  onWireApiChange,
  onSave,
  wireApi,
}: {
  open: boolean;
  busy: boolean;
  dialogError: string | null;
  editLabel: string;
  editBaseUrl: string;
  manageModels: ModelListRow[];
  apiKey?: string;
  browseSource?: "remote" | "models.dev";
  remoteProvider?: "ollama" | "openai_compatible";
  providerInstanceId?: string;
  hostMode?: "local" | "cloud";
  browseLabel?: string;
  onOpenChange: (open: boolean) => void;
  onDisplayNameChange: (value: string) => void;
  onBaseUrlChange: (value: string) => void;
  onCustomModelsChange: (rows: ModelListRow[]) => void;
  onWireApiChange?: (value: WireApi) => void;
  onSave: () => void;
  wireApi?: WireApi;
}) {
  return (
    <ProviderModelsDialogShell
      busy={busy}
      dialogError={dialogError}
      onOpenChange={onOpenChange}
      onSave={onSave}
      open={open}
      title="Edit provider"
    >
      <CustomProviderFields
        apiKey={apiKey}
        baseUrl={editBaseUrl}
        baseUrlError={null}
        browseLabel={browseLabel}
        browseSource={browseSource}
        customModels={manageModels}
        disabled={busy}
        displayName={editLabel}
        displayNameError={null}
        hostMode={hostMode}
        modelsError={null}
        onBaseUrlChange={onBaseUrlChange}
        onCustomModelsChange={onCustomModelsChange}
        onDisplayNameChange={onDisplayNameChange}
        onWireApiChange={onWireApiChange}
        providerInstanceId={providerInstanceId}
        remoteProvider={remoteProvider}
        wireApi={wireApi}
      />
    </ProviderModelsDialogShell>
  );
}

export function ProviderRemoveDialog({
  open,
  label,
  isSole,
  busy,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  label: string;
  isSole: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!(nextOpen || busy)) {
          onOpenChange(false);
        }
      }}
      open={open}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Remove provider?</DialogTitle>
          <DialogDescription>
            {isSole ? "This is your only LLM provider. " : null}
            Models using {label} will stop working. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            disabled={busy}
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            disabled={busy}
            onClick={onConfirm}
            type="button"
            variant="destructive"
          >
            {busy ? <Spinner className="size-4" /> : "Remove"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProviderManageModelsDialog({
  open,
  busy,
  dialogError,
  onOpenChange,
  onSave,
  children,
}: {
  open: boolean;
  busy: boolean;
  dialogError: string | null;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
  children: ReactNode;
}) {
  return (
    <ProviderModelsDialogShell
      busy={busy}
      description="Edit the shortlist available in chat for this provider."
      dialogError={dialogError}
      onOpenChange={onOpenChange}
      onSave={onSave}
      open={open}
      title="Manage models"
    >
      {children}
    </ProviderModelsDialogShell>
  );
}
