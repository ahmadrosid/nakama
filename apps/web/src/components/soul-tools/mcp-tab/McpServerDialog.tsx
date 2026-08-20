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
            state.setTransport("stdio");
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
        onNameChange={(value) => {
          state.setName(value);
          state.clearTestResult();
        }}
        onOpenImport={state.openImportDialog}
        onTestConnection={() => void state.handleTestConnection()}
        onTransportChange={(nextTransport) => {
          state.setTransport(nextTransport);
          state.clearTestResult();
        }}
        onUrlChange={(value) => {
          state.setUrl(value);
          if (value.trim()) {
            state.setTransport("http");
          }
          state.clearTestResult();
        }}
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
          {busy ? <Spinner className="size-4" /> : submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function McpServerDialog({
  open,
  busy,
  server,
  availableServers,
  onOpenChange,
  onSubmit,
  onAssign,
}: {
  open: boolean;
  busy: boolean;
  server?: McpServerSummary | null;
  availableServers?: McpServerSummary[];
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

  const assignMode = canAssignExisting && mode === "existing";

  return (
    <>
      <Dialog onOpenChange={onOpenChange} open={open}>
        <DialogContent className="gap-6 p-6 sm:max-w-lg">
          <DialogHeader className="gap-2">
            <DialogTitle>
              {state.isEdit ? "Edit MCP server" : "Add MCP server"}
            </DialogTitle>
            <DialogDescription>
              {state.isEdit
                ? state.transport === "stdio"
                  ? "Update the command, args, or environment. Leave values blank to keep the current ones."
                  : "Update the server URL or headers. Leave values blank to keep the current ones."
                : canAssignExisting
                  ? "Add a registered server or create a new one."
                  : onAssign
                    ? "Register an HTTP or command-based server and assign it to this profile."
                    : "Register an HTTP or command-based server, then assign it to profiles on the Profiles page."}
            </DialogDescription>
            {canAssignExisting ? (
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
                    aria-controls={`${state.idPrefix}-mode-panel-${item.id}`}
                    aria-selected={mode === item.id}
                    className="segmented-control-item"
                    data-active={mode === item.id || undefined}
                    disabled={state.formDisabled}
                    id={`${state.idPrefix}-mode-${item.id}`}
                    key={item.id}
                    onClick={() => {
                      setMode(item.id);
                    }}
                    role="tab"
                    type="button"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}
          </DialogHeader>

          {canAssignExisting && onAssign ? (
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
                  servers={availableServers ?? []}
                />
              </div>
              <McpServerDialogCreateForm
                aria-hidden={assignMode}
                busy={busy}
                className={cn(
                  "col-start-1 row-start-1",
                  assignMode && "invisible"
                )}
                id={`${state.idPrefix}-mode-panel-new`}
                inert={assignMode}
                nameAutoFocus={!assignMode}
                onOpenChange={onOpenChange}
                role="tabpanel"
                state={state}
                submitLabel="Add server"
              />
            </div>
          ) : (
            <McpServerDialogCreateForm
              busy={busy}
              onOpenChange={onOpenChange}
              state={state}
              submitLabel={state.isEdit ? "Save changes" : "Add server"}
            />
          )}
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
