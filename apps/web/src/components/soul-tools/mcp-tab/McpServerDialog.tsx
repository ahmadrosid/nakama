import type {
  CreateMcpServerRequest,
  McpServerResponse,
  McpServerSummary,
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
import { Spinner } from "@nakama/ui/spinner";
import { cn } from "@nakama/ui/utils";
import { type ComponentProps, useState } from "react";
import {
  McpAppPicker,
  McpConnectApp,
  McpCustomConnection,
  McpSignInPending,
  type PopularServer,
} from "@/components/soul-tools/mcp-tab/mcp-connect-app-views";
import { McpImportConfigDialog } from "@/components/soul-tools/mcp-tab/mcp-import-config-dialog";
import { McpServerDialogForm } from "@/components/soul-tools/mcp-tab/mcp-server-dialog-form";
import { unregisteredPopularServers } from "@/components/soul-tools/mcp-tab/popular-mcp-servers";
import { useMcpServerDialogState } from "@/components/soul-tools/mcp-tab/use-mcp-server-dialog-state";
import { useMcpServersQuery } from "@/hooks/use-app-queries";

type McpServerDialogState = ReturnType<typeof useMcpServerDialogState>;

function mcpServerDialogDescription({
  transport,
}: {
  transport: string;
}): string {
  if (transport === "stdio") {
    return "Update the command, args, or environment. Leave values blank to keep the current ones.";
  }

  return "Update the server URL or headers. Leave values blank to keep the current ones.";
}

function McpServerDialogCreateForm({
  busy,
  className,
  onOpenChange,
  showKindPicker = true,
  state,
  submitLabel,
  ...formProps
}: {
  busy: boolean;
  className?: string;
  onOpenChange: (open: boolean) => void;
  showKindPicker?: boolean;
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
        command={state.command}
        env={state.env}
        formDisabled={state.formDisabled}
        headers={state.headers}
        idPrefix={state.idPrefix}
        isEdit={state.isEdit}
        kind={state.kind}
        loadingForm={state.loadingForm}
        name={state.name}
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
        onUrlChange={(value) => {
          state.setUrl(value);
          state.clearTestResult();
        }}
        showKindPicker={showKindPicker}
        submitError={state.submitError}
        testResult={state.testResult}
        url={state.url}
      />

      <DialogFooter className="gap-3 border-t-0 bg-transparent p-3 sm:justify-end">
        <Button
          className="sm:mr-auto"
          disabled={state.formDisabled || !state.canSubmit}
          onClick={() => void state.handleTestConnection()}
          type="button"
          variant="outline"
        >
          {state.testing ? <Spinner className="size-4" /> : "Test connection"}
        </Button>
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
          ) : (state.kind === "signin" ||
              state.testResult?.requiresAuthorization) &&
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

type CreateView = "apps" | "connect" | "custom";

function McpCreateBody({
  availableServers,
  busy,
  onAssign,
  onOpenChange,
  state,
}: {
  availableServers?: McpServerSummary[];
  busy: boolean;
  onAssign?: (serverId: string) => void;
  onOpenChange: (open: boolean) => void;
  state: McpServerDialogState;
}) {
  const [view, setView] = useState<CreateView>("apps");
  const [preset, setPreset] = useState<PopularServer | null>(null);
  const [query, setQuery] = useState("");

  // Every server in the org, assigned or not, so a preset never duplicates one.
  const { data: orgServers } = useMcpServersQuery();

  function startForm(name: string, url: string) {
    state.selectKind("signin");
    state.setName(name);
    state.setUrl(url);
  }

  if (state.pendingAuth) {
    return (
      <McpSignInPending
        name={state.pendingAuth.name}
        onDone={() => onOpenChange(false)}
        preset={preset ?? undefined}
        serverId={state.pendingAuth.serverId}
        url={state.pendingAuth.url}
      />
    );
  }

  if (view === "connect" && preset) {
    return (
      <McpConnectApp
        busy={busy}
        canSubmit={state.canSubmit}
        onBack={() => setView("apps")}
        onSubmit={state.handleSubmit}
        preset={preset}
        submitError={state.submitError}
      />
    );
  }

  if (view === "custom") {
    return (
      <McpCustomConnection
        kind={state.kind}
        onBack={() => setView("apps")}
        onImport={state.openImportDialog}
        onKindChange={state.selectKind}
      >
        <McpServerDialogCreateForm
          busy={busy}
          onOpenChange={onOpenChange}
          showKindPicker={false}
          state={state}
          submitLabel="Connect"
        />
      </McpCustomConnection>
    );
  }

  return (
    <McpAppPicker
      busy={busy}
      onAssign={onAssign}
      onConnect={(item) => {
        setPreset(item);
        startForm(item.name, item.url);
        setView("connect");
      }}
      onCustom={() => {
        setPreset(null);
        startForm("", "");
        setView("custom");
      }}
      onQueryChange={setQuery}
      popular={unregisteredPopularServers(orgServers ?? availableServers)}
      query={query}
      registered={onAssign ? (availableServers ?? []) : []}
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
  onSubmit: (
    request: CreateMcpServerRequest
  ) => Promise<McpServerResponse | void>;
  onAssign?: (serverId: string) => void;
}) {
  const state = useMcpServerDialogState({ busy, onSubmit, open, server });

  return (
    <>
      <Dialog onOpenChange={onOpenChange} open={open}>
        {state.isEdit ? (
          <DialogContent className="gap-6 p-6 sm:max-w-lg">
            <DialogHeader className="gap-2">
              <DialogTitle>Edit MCP server</DialogTitle>
              <DialogDescription>
                {mcpServerDialogDescription({ transport: state.transport })}
              </DialogDescription>
              {error ? (
                <p className="text-destructive text-sm" role="alert">
                  {error}
                </p>
              ) : null}
            </DialogHeader>
            <McpServerDialogCreateForm
              busy={busy}
              onOpenChange={onOpenChange}
              state={state}
              submitLabel="Save changes"
            />
          </DialogContent>
        ) : (
          <DialogContent className="top-4 -translate-y-0 gap-0 overflow-hidden p-0 sm:top-[8dvh] sm:h-[36rem] sm:max-h-[84dvh] sm:max-w-2xl">
            <DialogDescription className="sr-only">
              Pick an app to connect to this agent.
            </DialogDescription>
            {error ? (
              <p
                className="mx-6 mt-6 mr-14 rounded-md bg-destructive/10 px-3 py-2.5 text-destructive text-sm"
                role="alert"
              >
                {error}
              </p>
            ) : null}
            {open ? (
              <McpCreateBody
                availableServers={availableServers}
                busy={busy}
                onAssign={onAssign}
                onOpenChange={onOpenChange}
                state={state}
              />
            ) : null}
          </DialogContent>
        )}
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
