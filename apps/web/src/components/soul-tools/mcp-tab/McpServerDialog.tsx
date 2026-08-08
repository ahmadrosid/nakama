import type {
  CreateMcpServerRequest,
  McpServerSummary,
} from "@nakama/core/contract";
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

export function McpServerDialog({
  open,
  busy,
  server,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  server?: McpServerSummary | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (request: CreateMcpServerRequest) => Promise<void>;
}) {
  const state = useMcpServerDialogState({ busy, onSubmit, open, server });

  return (
    <>
      <Dialog onOpenChange={onOpenChange} open={open}>
        <DialogContent className="gap-6 p-6 sm:max-w-lg">
          <form
            className="space-y-6"
            onPaste={state.handlePaste}
            onSubmit={state.handleSubmit}
          >
            <DialogHeader className="gap-2">
              <DialogTitle>
                {state.isEdit ? "Edit MCP server" : "Add MCP server"}
              </DialogTitle>
              <DialogDescription>
                {state.isEdit
                  ? state.transport === "stdio"
                    ? "Update the command, args, or environment. Leave values blank to keep the current ones."
                    : "Update the server URL or headers. Leave values blank to keep the current ones."
                  : "Register an HTTP or command-based server, then assign it to profiles on the Profiles page."}
              </DialogDescription>
            </DialogHeader>

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
              <Button
                disabled={state.formDisabled || !state.canSubmit}
                type="submit"
              >
                {busy ? (
                  <Spinner className="size-4" />
                ) : state.isEdit ? (
                  "Save changes"
                ) : (
                  "Add server"
                )}
              </Button>
            </DialogFooter>
          </form>
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
