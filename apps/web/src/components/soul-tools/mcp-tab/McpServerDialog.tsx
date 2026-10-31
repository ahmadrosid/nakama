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
import { toast } from "@nakama/ui/toast";
import { cn } from "@nakama/ui/utils";
import { useQueryClient } from "@tanstack/react-query";
import { type ComponentProps, useState } from "react";
import {
  McpAppPicker,
  McpCustomConnection,
  McpSignInPending,
  type PopularServer,
} from "@/components/soul-tools/mcp-tab/mcp-connect-app-views";
import { McpImportConfigDialog } from "@/components/soul-tools/mcp-tab/mcp-import-config-dialog";
import { McpServerDialogForm } from "@/components/soul-tools/mcp-tab/mcp-server-dialog-form";
import { unregisteredPopularServers } from "@/components/soul-tools/mcp-tab/popular-mcp-servers";
import { useMcpServerDialogState } from "@/components/soul-tools/mcp-tab/use-mcp-server-dialog-state";
import { useAuth } from "@/context/use-auth";
import { useMcpServersQuery } from "@/hooks/use-app-queries";
import { connectComposioApp, useComposioToolkits } from "@/hooks/use-composio";
import { formatError } from "@/lib/client";
import { invalidateQueries } from "@/lib/query-client";
import { queryKeys } from "@/lib/query-keys";

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

type CreateView = "apps" | "custom";

function McpCreateBody({
  availableServers,
  busy,
  onAssign,
  onOpenChange,
  profileId,
  state,
}: {
  availableServers?: McpServerSummary[];
  busy: boolean;
  onAssign?: (serverId: string) => void;
  onOpenChange: (open: boolean) => void;
  profileId?: string;
  state: McpServerDialogState;
}) {
  const queryClient = useQueryClient();
  const { activeOrg } = useAuth();
  const isOrgAdmin = activeOrg?.role === "admin";
  const [view, setView] = useState<CreateView>("apps");
  const [query, setQuery] = useState("");
  const [connecting, setConnecting] = useState(false);

  // Every server in the org, assigned or not, so a preset never duplicates one.
  const { data: orgServers } = useMcpServersQuery();
  const { data: composio } = useComposioToolkits();

  // A member cannot turn a toolkit on, so they see only the ones an admin has.
  const enabledSlugs = new Set(
    composio?.orgToolkits
      .filter((item) => item.status === "enabled")
      .map((item) => item.toolkitSlug)
  );

  const offered = composio?.configured
    ? composio.catalog.filter(
        (item) => isOrgAdmin || enabledSlugs.has(item.slug)
      )
    : [];

  async function connectApp(item: PopularServer) {
    if (!composio) {
      return;
    }

    setConnecting(true);

    try {
      const signInUrl = await connectComposioApp({
        isOrgAdmin,
        profileId,
        returnTo: `${window.location.pathname}${window.location.search}`,
        toolkitSlug: item.toolkit,
        toolkits: composio,
      });

      if (signInUrl) {
        window.location.href = signInUrl;

        return;
      }

      await invalidateQueries(
        queryClient,
        queryKeys.composio.toolkits,
        queryKeys.composio.profileToolkits(profileId ?? "none"),
        queryKeys.profiles.all
      );
      toast(`${item.name} is ready`);
      onOpenChange(false);
    } catch (error) {
      toast(formatError(error));
      setConnecting(false);
    }
  }

  if (state.pendingAuth) {
    return (
      <McpSignInPending
        name={state.pendingAuth.name}
        onDone={() => onOpenChange(false)}
        opened={state.pendingAuth.opened}
        serverId={state.pendingAuth.serverId}
        url={state.pendingAuth.url}
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
      busy={busy || connecting}
      onAssign={onAssign}
      onConnect={(item) => void connectApp(item)}
      onCustom={() => {
        state.selectKind("signin");
        state.setName("");
        state.setUrl("");
        setView("custom");
      }}
      onQueryChange={setQuery}
      popular={unregisteredPopularServers(
        orgServers ?? availableServers,
        offered
      )}
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
  profileId,
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
  /** The agent the dialog adds to; a preset app is assigned to it. */
  profileId?: string;
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
          <DialogContent className="top-4 -translate-y-0 gap-0 overflow-hidden p-0 sm:top-[8dvh] sm:max-h-[84dvh] sm:min-h-[26rem] sm:max-w-2xl">
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
                profileId={profileId}
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
