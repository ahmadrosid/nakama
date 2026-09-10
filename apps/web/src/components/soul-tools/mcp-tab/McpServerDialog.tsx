import type {
  CreateMcpServerRequest,
  McpServerSummary,
} from "@nakama/core/contract";
import { type ComponentProps, useState } from "react";
import { McpServerAssignList } from "@/components/McpServerAssignList";
import { McpImportConfigDialog } from "@/components/soul-tools/mcp-tab/mcp-import-config-dialog";
import { McpServerDialogForm } from "@/components/soul-tools/mcp-tab/mcp-server-dialog-form";
import { useMcpServerDialogState } from "@/components/soul-tools/mcp-tab/use-mcp-server-dialog-state";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

type AddMcpMode = "existing" | "new";
type McpServerDialogState = ReturnType<typeof useMcpServerDialogState>;

function mcpServerDialogDescription({
  isEdit,
  transport,
  canAssignExisting,
  onAssign,
}: {
  isEdit: boolean;
  transport: string;
  canAssignExisting: boolean;
  onAssign?: (serverId: string) => void;
}): string {
  if (isEdit) {
    if (transport === "stdio") {
      return "Update the command, args, or environment. Leave values blank to keep the current ones.";
    }
    return "Update the server URL or headers. Leave values blank to keep the current ones.";
  }

  if (canAssignExisting) {
    return "Add a registered server or create a new one.";
  }

  if (onAssign) {
    return "Register an HTTP or command-based server and assign it to this profile.";
  }

  return "Register an HTTP or command-based server, then assign it to profiles on the Profiles page.";
}

function McpServerModeTabs({
  idPrefix,
  mode,
  formDisabled,
  onModeChange,
}: {
  idPrefix: string;
  mode: AddMcpMode;
  formDisabled: boolean;
  onModeChange: (mode: AddMcpMode) => void;
}) {
  return (
    <div
      aria-label="Add MCP server"
      className="segmented-control w-full"
      role="tablist"
    >
      {(
        [
          { id: "existing" as const, label: "Existing" },
          { id: "new" as const, label: "New" },
        ] as const
      ).map((item) => (
        <button
          aria-controls={`${idPrefix}-mode-panel-${item.id}`}
          aria-selected={mode === item.id}
          className="segmented-control-item"
          data-active={mode === item.id || undefined}
          disabled={formDisabled}
          id={`${idPrefix}-mode-${item.id}`}
          key={item.id}
          onClick={() => {
            onModeChange(item.id);
          }}
          role="tab"
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function McpServerDialogPanels({
  assignMode,
  busy,
  availableServers,
  onAssign,
  onOpenChange,
  state,
}: {
  assignMode: boolean;
  busy: boolean;
  availableServers: McpServerSummary[];
  onAssign: (serverId: string) => void;
  onOpenChange: (open: boolean) => void;
  state: McpServerDialogState;
}) {
  return (
    <div className="grid">
      <div
        aria-hidden={!assignMode}
        className={cn(
          "col-start-1 row-start-1 flex min-h-0 flex-col",
          !assignMode && "invisible"
        )}
        id={`${state.idPrefix}-mode-panel-existing`}
        inert={!assignMode}
        role="tabpanel"
      >
        <McpServerAssignList
          disabled={busy}
          onAssign={onAssign}
          servers={availableServers}
        />
      </div>
      <McpServerDialogCreateForm
        aria-hidden={assignMode}
        busy={busy}
        className={cn("col-start-1 row-start-1", assignMode && "invisible")}
        id={`${state.idPrefix}-mode-panel-new`}
        inert={assignMode}
        nameAutoFocus={!assignMode}
        onOpenChange={onOpenChange}
        role="tabpanel"
        state={state}
        submitLabel="Add server"
      />
    </div>
  );
}

function McpServerDialogCreateForm({
  busy,
  className,
  nameAutoFocus,
  onOpenChange,
  state,
  submitLabel,
  ...formProps
}: {
  busy: boolean;
  className?: string;
  nameAutoFocus?: boolean;
  onOpenChange: (open: boolean) => void;
  state: McpServerDialogState;
  submitLabel: string;
} & ComponentProps<"form">) {
  return (
    <form
      className={cn("space-y-6", className)}
      onPaste={state.handlePaste}
      onSubmit={state.handleSubmit}
      {...formProps}
    >
      <McpServerDialogForm
        args={state.args}
        canSubmit={state.canSubmit}
        command={state.command}
        env={state.env}
        formDisabled={state.formDisabled}
        headers={state.headers}
        idPrefix={state.idPrefix}
        isEdit={state.isEdit}
        loadingForm={state.loadingForm}
        name={state.name}
        nameAutoFocus={nameAutoFocus}
        onArgsChange={(nextArgs) => {
          state.setArgs(nextArgs);
          state.clearTestResult();
        }}
        onCommandChange={(value) => {
          state.setCommand(value);
          if (value.trim()) {
            state.selectKind("stdio");
          }
          state.clearTestResult();
        }}
        onEnvChange={(nextEnv) => {
          state.setEnv(nextEnv);
          state.clearTestResult();
        }}
        onHeadersChange={(nextHeaders) => {
          state.setHeaders(nextHeaders);
          state.clearTestResult();
        }}
        onKindChange={state.selectKind}
        onNameChange={(value) => {
          state.setName(value);
          state.clearTestResult();
        }}
        onOpenImport={state.openImportDialog}
        onTestConnection={() => void state.handleTestConnection()}
        onUrlChange={(value) => {
          state.setUrl(value);
          state.clearTestResult();
        }}
        signIn={state.signIn}
        submitError={state.submitError}
        testing={state.testing}
        testResult={state.testResult}
        transport={state.transport}
        url={state.url}
      />

      <DialogFooter className="gap-3 border-t-0 bg-transparent p-3 sm:justify-end">
        <Button
          disabled={state.formDisabled}
          onClick={() => onOpenChange(false)}
          type="button"
          variant="outline"
        >
          Cancel
        </Button>
        <Button disabled={state.formDisabled || !state.canSubmit} type="submit">
          {busy ? (
            <Spinner className="size-4" />
          ) : (state.signIn || state.testResult?.requiresAuthorization) &&
            !state.isEdit ? (
            "Add and sign in"
          ) : (
            submitLabel
          )}
        </Button>
      </DialogFooter>
    </form>
  );
}

function McpServerDialogHeader({
  canAssignExisting,
  error,
  formDisabled,
  idPrefix,
  isEdit,
  mode,
  onAssign,
  onModeChange,
  transport,
}: {
  canAssignExisting: boolean;
  error: string | null;
  formDisabled: boolean;
  idPrefix: string;
  isEdit: boolean;
  mode: AddMcpMode;
  onAssign?: (serverId: string) => void;
  onModeChange: (mode: AddMcpMode) => void;
  transport: string;
}) {
  return (
    <DialogHeader className="gap-2">
      <DialogTitle>{isEdit ? "Edit MCP server" : "Add MCP server"}</DialogTitle>
      <DialogDescription>
        {mcpServerDialogDescription({
          canAssignExisting,
          isEdit,
          onAssign,
          transport,
        })}
      </DialogDescription>
      {canAssignExisting ? (
        <McpServerModeTabs
          formDisabled={formDisabled}
          idPrefix={idPrefix}
          mode={mode}
          onModeChange={onModeChange}
        />
      ) : null}
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </DialogHeader>
  );
}

function McpServerDialogBody({
  assignMode,
  availableServers,
  busy,
  canAssignExisting,
  onAssign,
  onOpenChange,
  state,
}: {
  assignMode: boolean;
  availableServers: McpServerSummary[];
  busy: boolean;
  canAssignExisting: boolean;
  onAssign?: (serverId: string) => void;
  onOpenChange: (open: boolean) => void;
  state: McpServerDialogState;
}) {
  if (canAssignExisting && onAssign) {
    return (
      <McpServerDialogPanels
        assignMode={assignMode}
        availableServers={availableServers}
        busy={busy}
        onAssign={onAssign}
        onOpenChange={onOpenChange}
        state={state}
      />
    );
  }

  return (
    <McpServerDialogCreateForm
      busy={busy}
      onOpenChange={onOpenChange}
      state={state}
      submitLabel={state.isEdit ? "Save changes" : "Add server"}
    />
  );
}

export function McpServerDialog({
  open,
  busy,
  server,
  availableServers,
  error = null,
  onOpenChange,
  onSubmit,
  onAssign,
}: {
  open: boolean;
  busy: boolean;
  server?: McpServerSummary | null;
  availableServers?: McpServerSummary[];
  error?: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (request: CreateMcpServerRequest) => Promise<void>;
  onAssign?: (serverId: string) => void;
}) {
  const state = useMcpServerDialogState({ busy, onSubmit, open, server });
  const canAssignExisting =
    !state.isEdit && onAssign != null && (availableServers?.length ?? 0) > 0;
  const defaultMode: AddMcpMode = canAssignExisting ? "existing" : "new";
  const modeResetKey = open ? "open" : "closed";
  const [mode, setMode] = useState<AddMcpMode>(defaultMode);
  const [prevModeResetKey, setPrevModeResetKey] = useState(modeResetKey);

  if (modeResetKey !== prevModeResetKey) {
    setPrevModeResetKey(modeResetKey);
    if (open) {
      setMode(defaultMode);
    }
  }

  return (
    <>
      <Dialog onOpenChange={onOpenChange} open={open}>
        <DialogContent className="gap-6 p-6 sm:max-w-lg">
          <McpServerDialogHeader
            canAssignExisting={canAssignExisting}
            error={error}
            formDisabled={state.formDisabled}
            idPrefix={state.idPrefix}
            isEdit={state.isEdit}
            mode={mode}
            onAssign={onAssign}
            onModeChange={setMode}
            transport={state.transport}
          />
          <McpServerDialogBody
            assignMode={canAssignExisting && mode === "existing"}
            availableServers={availableServers ?? []}
            busy={busy}
            canAssignExisting={canAssignExisting}
            onAssign={onAssign}
            onOpenChange={onOpenChange}
            state={state}
          />
        </DialogContent>
      </Dialog>

      <McpImportConfigDialog
        formDisabled={state.formDisabled}
        importDraft={state.importDraft}
        importError={state.importError}
        onApply={state.handleImportApply}
        onImportDraftChange={(value) => {
          state.setImportDraft(value);
          if (state.importError) {
            state.setImportError(null);
          }
        }}
        onOpenChange={state.setImportOpen}
        open={state.importOpen}
      />
    </>
  );
}
