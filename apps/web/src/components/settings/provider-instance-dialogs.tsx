import type {
  ChatgptOAuthCredentials,
  ProviderInstanceSummary,
  WireApi,
  XaiOAuthCredentials,
} from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nakama/ui/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@nakama/ui/input-group";
import { Spinner } from "@nakama/ui/spinner";
import { ViewIcon, ViewOffIcon } from "hugeicons-react";
import type { ReactNode } from "react";
import {
  ChatgptSignInPanel,
  XaiSignInPanel,
} from "@/components/ChatgptSignInPanel";
import { CustomProviderFields } from "@/components/CustomProviderFields";
import type { ModelListRow } from "@/components/ModelListEditor";
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
  onManage,
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
  onManage?: (action: "clear" | "use-stored") => void;
}) {
  let title = `${instance.hasApiKey ? "Update API key" : "Add API key"} for ${instance.label}`;
  let hasCredentials = Boolean(apiKey.trim());

  switch (providerType) {
    case "xai_oauth":
      title = `Reconnect ${instance.label}`;
      hasCredentials = Boolean(xaiOAuth);
      break;
    case "chatgpt":
      title = `Reconnect ${instance.label}`;
      hasCredentials = Boolean(chatgptOAuth);
      break;
    default:
      break;
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <ProviderCredentialField
          apiKey={apiKey}
          busy={busy}
          chatgptOAuth={chatgptOAuth}
          instance={instance}
          onApiKeyChange={onApiKeyChange}
          onChatgptOAuthChange={onChatgptOAuthChange}
          onToggleShowApiKey={onToggleShowApiKey}
          onXaiOAuthChange={onXaiOAuthChange}
          providerType={providerType}
          showApiKey={showApiKey}
          xaiOAuth={xaiOAuth}
        />
        {instance.secretSource === "environment" ? (
          <p className="text-sm">
            Managed by {instance.secretEnvName}. Restart Nakama after you change
            it.
          </p>
        ) : null}
        {dialogError ? (
          <p className="text-destructive text-sm" role="alert">
            {dialogError}
          </p>
        ) : null}
        <DialogFooter>
          {instance.secretSource === "settings" ? (
            <Button
              disabled={busy}
              onClick={() => onManage?.("clear")}
              type="button"
              variant="outline"
            >
              Clear saved key
            </Button>
          ) : null}
          {instance.secretSource === "missing" &&
          instance.savedSecretAvailable ? (
            <Button
              disabled={busy}
              onClick={() => onManage?.("use-stored")}
              type="button"
              variant="outline"
            >
              Use saved key
            </Button>
          ) : null}
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
              busy || instance.secretSource === "environment" || !hasCredentials
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

function ProviderCredentialField({
  apiKey,
  busy,
  chatgptOAuth,
  instance,
  onApiKeyChange,
  onChatgptOAuthChange,
  onToggleShowApiKey,
  onXaiOAuthChange,
  providerType,
  showApiKey,
  xaiOAuth,
}: {
  apiKey: string;
  busy: boolean;
  chatgptOAuth: ChatgptOAuthCredentials | null;
  instance: ProviderInstanceSummary;
  onApiKeyChange: (value: string) => void;
  onChatgptOAuthChange: (oauth: ChatgptOAuthCredentials | null) => void;
  onToggleShowApiKey: () => void;
  onXaiOAuthChange: (oauth: XaiOAuthCredentials | null) => void;
  providerType: SelectedProvider;
  showApiKey: boolean;
  xaiOAuth: XaiOAuthCredentials | null;
}) {
  if (providerType === "xai_oauth") {
    return (
      <XaiSignInPanel
        disabled={busy}
        oauth={xaiOAuth}
        onOAuthChange={onXaiOAuthChange}
      />
    );
  }
  if (providerType === "chatgpt") {
    return (
      <ChatgptSignInPanel
        disabled={busy}
        oauth={chatgptOAuth}
        onOAuthChange={onChatgptOAuthChange}
      />
    );
  }
  return (
    <InputGroup>
      <InputGroupInput
        autoComplete="off"
        disabled={busy || instance.secretSource === "environment"}
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
      <DialogContent className="w-[min(96vw,56rem)] grid-cols-1 sm:max-w-4xl">
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
  hideIdentity = false,
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
  remoteProvider?: "ollama" | "openai_compatible" | "netra";
  hideIdentity?: boolean;
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
        hideIdentity={hideIdentity}
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
  title = "Manage models",
}: {
  open: boolean;
  busy: boolean;
  dialogError: string | null;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
  children: ReactNode;
  title?: string;
}) {
  return (
    <ProviderModelsDialogShell
      busy={busy}
      description="Edit the shortlist available in chat for this provider."
      dialogError={dialogError}
      onOpenChange={onOpenChange}
      onSave={onSave}
      open={open}
      title={title}
    >
      {children}
    </ProviderModelsDialogShell>
  );
}
