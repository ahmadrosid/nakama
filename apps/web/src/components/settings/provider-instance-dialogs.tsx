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
import { type ReactNode, useRef, useState } from "react";
import {
  DeviceSignInCode,
  useDeviceSignIn,
} from "@/components/ChatgptSignInPanel";
import { CustomProviderFields } from "@/components/CustomProviderFields";
import type { ModelListRow } from "@/components/ModelListEditor";
import type { DeviceSignIn } from "@/components/subscription-sign-in.shared";
import { apiKeyPlaceholder, type SelectedProvider } from "@/lib/models";

function SavedKeyActions({
  busy,
  instance,
  onClearRequest,
  onManage,
}: {
  busy: boolean;
  instance: ProviderInstanceSummary;
  onClearRequest: () => void;
  onManage?: (action: "clear" | "use-stored") => void;
}) {
  if (instance.secretSource === "settings") {
    return (
      <Button
        className="text-destructive hover:text-destructive sm:mr-auto"
        disabled={busy}
        onClick={onClearRequest}
        type="button"
        variant="ghost"
      >
        Clear saved key
      </Button>
    );
  }

  if (instance.secretSource === "missing" && instance.savedSecretAvailable) {
    return (
      <Button
        disabled={busy}
        onClick={() => onManage?.("use-stored")}
        type="button"
        variant="outline"
      >
        Use saved key
      </Button>
    );
  }

  return null;
}

// Clearing a key stops chat for this provider: the dialog asks first, as
// Remove does, in place instead of a second dialog on top.
function ClearKeyConfirm({
  busy,
  label,
  onBack,
  onConfirm,
}: {
  busy: boolean;
  label: string;
  onBack: () => void;
  onConfirm: () => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Clear saved key?</DialogTitle>
        <DialogDescription>
          Chat with {label} stops until you add a key again.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button
          disabled={busy}
          onClick={onBack}
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
          {busy ? <Spinner className="mr-2" /> : null}
          Clear key
        </Button>
      </DialogFooter>
    </>
  );
}

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
  onManage,
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
  onManage?: (action: "clear" | "use-stored") => void;
}) {
  const [confirmingClear, setConfirmingClear] = useState(false);
  // An error from before the clear request is old news once the user moves on.
  const [dismissedError, setDismissedError] = useState<string | null>(null);

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        setConfirmingClear(false);
        onOpenChange(nextOpen);
      }}
      open={open}
    >
      <DialogContent className="sm:max-w-md">
        {confirmingClear ? (
          <ClearKeyConfirm
            busy={busy}
            label={instance.label}
            onBack={() => {
              setConfirmingClear(false);
              // Back on the form, where the user left off.
              requestAnimationFrame(() =>
                document.getElementById("replace-api-key")?.focus()
              );
            }}
            onConfirm={() => onManage?.("clear")}
          />
        ) : (
          <ReplaceKeyForm
            apiKey={apiKey}
            busy={busy}
            dialogError={dialogError === dismissedError ? null : dialogError}
            instance={instance}
            onApiKeyChange={onApiKeyChange}
            onCancel={() => onOpenChange(false)}
            onClearRequest={() => {
              setDismissedError(dialogError);
              setConfirmingClear(true);
            }}
            onManage={onManage}
            onSave={onSave}
            onToggleShowApiKey={onToggleShowApiKey}
            providerType={providerType}
            showApiKey={showApiKey}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReplaceKeyForm({
  apiKey,
  busy,
  dialogError,
  instance,
  onApiKeyChange,
  onCancel,
  onClearRequest,
  onManage,
  onSave,
  onToggleShowApiKey,
  providerType,
  showApiKey,
}: {
  apiKey: string;
  busy: boolean;
  dialogError: string | null;
  instance: ProviderInstanceSummary;
  onApiKeyChange: (value: string) => void;
  onCancel: () => void;
  onClearRequest: () => void;
  onManage?: (action: "clear" | "use-stored") => void;
  onSave: () => void;
  onToggleShowApiKey: () => void;
  providerType: SelectedProvider;
  showApiKey: boolean;
}) {
  return (
    // Enter in the key field saves, like the Add provider form.
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <DialogHeader>
        <DialogTitle>
          {instance.hasApiKey ? "Update API key" : "Add API key"} for{" "}
          {instance.label}
        </DialogTitle>
      </DialogHeader>
      <div className="flex items-center justify-between gap-2">
        <label className="font-medium text-sm" htmlFor="replace-api-key">
          {instance.hasApiKey ? "New API key" : "API key"}
        </label>
        {instance.secretSource === "settings" ? (
          <span className="text-muted-foreground text-xs">
            A key is already saved
          </span>
        ) : null}
      </div>
      <InputGroup>
        <InputGroupInput
          aria-invalid={dialogError != null}
          autoComplete="off"
          disabled={busy || instance.secretSource === "environment"}
          id="replace-api-key"
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
        <SavedKeyActions
          busy={busy}
          instance={instance}
          onClearRequest={onClearRequest}
          onManage={onManage}
        />
        <Button
          disabled={busy}
          onClick={onCancel}
          type="button"
          variant="outline"
        >
          Cancel
        </Button>
        <Button
          disabled={busy || instance.secretSource === "environment"}
          type="submit"
        >
          {busy ? <Spinner className="mr-2" /> : null}
          Save
        </Button>
      </DialogFooter>
    </form>
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

export function DiscardChangesConfirm({
  onDiscard,
  onKeep,
}: {
  onDiscard: () => void;
  onKeep: () => void;
}) {
  return (
    <div
      className="flex w-full flex-wrap items-center justify-end gap-2"
      role="alert"
    >
      <p className="mr-auto font-medium text-sm">Discard your changes?</p>
      <Button autoFocus onClick={onKeep} type="button" variant="outline">
        Keep editing
      </Button>
      <Button onClick={onDiscard} type="button" variant="destructive">
        Discard
      </Button>
    </div>
  );
}

function ProviderModelsDialogShell({
  open,
  busy,
  dialogError,
  dirty = false,
  saveSummary,
  title,
  onOpenChange,
  onSave,
  children,
}: {
  open: boolean;
  busy: boolean;
  dialogError: string | null;
  dirty?: boolean;
  saveSummary?: string | null;
  title: string;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
  children: ReactNode;
}) {
  // Open on the title, not inside a model ID a stray key press would change.
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  // Cancel, Escape and the close button ask first when there are edits.
  const requestClose = () => {
    if (dirty) {
      setConfirmingDiscard(true);

      return;
    }

    onOpenChange(false);
  };

  return (
    // A click outside must not drop unsaved model edits.
    <Dialog
      disablePointerDismissal
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          onOpenChange(true);
        } else {
          requestClose();
        }
      }}
      onOpenChangeComplete={(nextOpen) => {
        if (!nextOpen) {
          setConfirmingDiscard(false);
        }
      }}
      open={open}
    >
      <DialogContent
        className="w-[min(96vw,56rem)] scroll-pb-24 grid-cols-1 sm:max-w-4xl"
        initialFocus={titleRef}
      >
        <DialogHeader>
          <DialogTitle className="outline-none" ref={titleRef} tabIndex={-1}>
            {title}
          </DialogTitle>
        </DialogHeader>
        {children}
        {dialogError ? (
          <p className="text-destructive text-sm" role="alert">
            {dialogError}
          </p>
        ) : null}
        <DialogFooter className="sticky -bottom-4 z-10 bg-muted">
          {confirmingDiscard ? (
            <DiscardChangesConfirm
              onDiscard={() => onOpenChange(false)}
              onKeep={() => setConfirmingDiscard(false)}
            />
          ) : (
            <>
              {saveSummary ? (
                <p className="mr-auto self-center text-muted-foreground text-sm">
                  {saveSummary}
                </p>
              ) : null}
              <Button
                disabled={busy}
                onClick={requestClose}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button disabled={busy} onClick={onSave} type="button">
                Save
              </Button>
            </>
          )}
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
  title,
  wireApi,
  fieldErrors,
  dirty,
  saveSummary,
}: {
  open: boolean;
  busy: boolean;
  dialogError: string | null;
  dirty?: boolean;
  saveSummary?: string | null;
  editLabel: string;
  editBaseUrl: string;
  manageModels: ModelListRow[];
  apiKey?: string;
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
  title: string;
  wireApi?: WireApi;
  fieldErrors?: {
    baseUrl: string | null;
    displayName: string | null;
    models: string | null;
  };
}) {
  return (
    <ProviderModelsDialogShell
      busy={busy}
      dialogError={dialogError}
      dirty={dirty}
      onOpenChange={onOpenChange}
      onSave={onSave}
      open={open}
      saveSummary={saveSummary}
      title={title}
    >
      <CustomProviderFields
        apiKey={apiKey}
        baseUrl={editBaseUrl}
        baseUrlError={fieldErrors?.baseUrl ?? null}
        browseLabel={browseLabel}
        customModels={manageModels}
        disabled={busy}
        displayName={editLabel}
        displayNameError={fieldErrors?.displayName ?? null}
        hideIdentity={hideIdentity}
        hostMode={hostMode}
        modelsError={fieldErrors?.models ?? null}
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
  isDefault = false,
  isSole,
  nextDefaultLabel,
  busy,
  onOpenChange,
  onConfirm,
  usedBy = [],
}: {
  open: boolean;
  label: string;
  isDefault?: boolean;
  isSole: boolean;
  nextDefaultLabel?: string;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  usedBy?: string[];
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
            {isDefault && !isSole
              ? `This is your default provider. ${nextDefaultLabel ?? "Another provider"} becomes the default. `
              : null}
            Chats, agents and automations that use a {label} model will stop
            working. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {usedBy.length > 0 ? (
          <div className="space-y-1 text-sm">
            <p className="font-medium">These settings will have no model:</p>
            <ul className="list-disc pl-5 text-muted-foreground">
              {usedBy.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </div>
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
  dirty,
  saveSummary,
  onOpenChange,
  onSave,
  children,
  title,
}: {
  open: boolean;
  busy: boolean;
  dialogError: string | null;
  dirty?: boolean;
  saveSummary?: string | null;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
  children: ReactNode;
  title: string;
}) {
  return (
    <ProviderModelsDialogShell
      busy={busy}
      dialogError={dialogError}
      dirty={dirty}
      onOpenChange={onOpenChange}
      onSave={onSave}
      open={open}
      saveSummary={saveSummary}
      title={title}
    >
      {children}
    </ProviderModelsDialogShell>
  );
}
