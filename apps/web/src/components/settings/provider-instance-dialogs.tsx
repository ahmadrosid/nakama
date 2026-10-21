import type { ProviderInstanceSummary, WireApi } from "@nakama/core/contract";
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
import { LinkSquare02Icon, ViewIcon, ViewOffIcon } from "hugeicons-react";
import type { ReactNode } from "react";
import {
  type DeviceSignIn,
  DeviceSignInCode,
  useDeviceSignIn,
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
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {instance.hasApiKey ? "Update API key" : "Add API key"} for{" "}
            {instance.label}
          </DialogTitle>
        </DialogHeader>
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
            disabled={busy || !apiKey.trim()}
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

export function ProviderReconnectDialog<T>({
  open,
  instance,
  signIn,
  busy,
  dialogError,
  onOpenChange,
  onConnected,
}: {
  open: boolean;
  instance: ProviderInstanceSummary;
  signIn: DeviceSignIn<T>;
  busy: boolean;
  dialogError: string | null;
  onOpenChange: (open: boolean) => void;
  onConnected: (oauth: T) => void;
}) {
  const device = useDeviceSignIn(signIn, {
    onOAuthChange: (oauth) => {
      if (oauth) {
        onConnected(oauth);
      }
    },
  });

  const waiting = device.flow === "waiting";
  const error = device.error ?? dialogError;
  const verb = instance.hasApiKey ? "Reconnect" : "Connect";

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!(nextOpen || busy)) {
          device.cancel();
          onOpenChange(false);
        }
      }}
      open={open}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {verb} {signIn.label}?
          </DialogTitle>
          {instance.hasApiKey ? (
            <DialogDescription>
              You sign in again. The new account replaces the current one.
            </DialogDescription>
          ) : null}
        </DialogHeader>
        {waiting ? (
          <div className="space-y-3 rounded-md border p-3">
            <DeviceSignInCode
              loginUrl={device.loginUrl}
              userCode={device.userCode}
              verificationUri={device.verificationUri}
            />
          </div>
        ) : null}
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            disabled={busy}
            onClick={() => {
              device.cancel();
              onOpenChange(false);
            }}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            disabled={busy || waiting}
            onClick={() => void device.start()}
            type="button"
          >
            {busy || waiting ? (
              <Spinner className="mr-2" />
            ) : (
              <LinkSquare02Icon className="mr-2 size-4" />
            )}
            {waiting ? "Waiting for sign-in…" : verb}
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
