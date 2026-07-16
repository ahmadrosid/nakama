import type { CreateMcpServerRequest, McpServerSummary } from "@nakama/core/contract";
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
  const state = useMcpServerDialogState({ open, busy, server, onSubmit });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="gap-6 p-6 sm:max-w-lg">
          <form className="space-y-6" onSubmit={state.handleSubmit} onPaste={state.handlePaste}>
            <DialogHeader className="gap-2">
              <DialogTitle>{state.isEdit ? "Edit MCP server" : "Add MCP server"}</DialogTitle>
              <DialogDescription>
                {state.isEdit
                  ? state.transport === "stdio"
                    ? "Update the command, args, or environment. Leave values blank to keep the current ones."
                    : "Update the server URL or headers. Leave values blank to keep the current ones."
                  : "Register an HTTP or command-based server, then assign it to profiles on the Profiles page."}
              </DialogDescription>
            </DialogHeader>

            <McpServerDialogForm
              idPrefix={state.idPrefix}
              isEdit={state.isEdit}
              transport={state.transport}
              name={state.name}
              url={state.url}
              headers={state.headers}
              command={state.command}
              args={state.args}
              env={state.env}
              formDisabled={state.formDisabled}
              loadingForm={state.loadingForm}
              canSubmit={state.canSubmit}
              testing={state.testing}
              testResult={state.testResult}
              submitError={state.submitError}
              onTransportChange={(nextTransport) => {
                state.setTransport(nextTransport);
                state.clearTestResult();
              }}
              onOpenImport={state.openImportDialog}
              onNameChange={(value) => {
                state.setName(value);
                state.clearTestResult();
              }}
              onUrlChange={(value) => {
                state.setUrl(value);
                if (value.trim()) {
                  state.setTransport("http");
                }
                state.clearTestResult();
              }}
              onHeadersChange={(nextHeaders) => {
                state.setHeaders(nextHeaders);
                state.clearTestResult();
              }}
              onCommandChange={(value) => {
                state.setCommand(value);
                if (value.trim()) {
                  state.setTransport("stdio");
                }
                state.clearTestResult();
              }}
              onArgsChange={(nextArgs) => {
                state.setArgs(nextArgs);
                state.clearTestResult();
              }}
              onEnvChange={(nextEnv) => {
                state.setEnv(nextEnv);
                state.clearTestResult();
              }}
              onTestConnection={() => void state.handleTestConnection()}
            />

            <DialogFooter className="gap-3 border-t-0 bg-transparent p-3 sm:justify-end">
              <Button
                type="button"
                variant="outline"
                disabled={state.formDisabled}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={state.formDisabled || !state.canSubmit}>
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
        open={state.importOpen}
        importDraft={state.importDraft}
        importError={state.importError}
        formDisabled={state.formDisabled}
        onOpenChange={state.setImportOpen}
        onImportDraftChange={(value) => {
          state.setImportDraft(value);
          if (state.importError) {
            state.setImportError(null);
          }
        }}
        onApply={state.handleImportApply}
      />
    </>
  );
}
