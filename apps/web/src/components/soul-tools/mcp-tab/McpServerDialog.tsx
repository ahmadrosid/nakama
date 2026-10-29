import type {
  CreateMcpServerRequest,
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
import { CodeIcon } from "hugeicons-react";
import { type ComponentProps, type ReactNode, useState } from "react";
import { McpImportConfigDialog } from "@/components/soul-tools/mcp-tab/mcp-import-config-dialog";
import { McpServerDialogForm } from "@/components/soul-tools/mcp-tab/mcp-server-dialog-form";
import {
  type POPULAR_SERVERS,
  unregisteredPopularServers,
} from "@/components/soul-tools/mcp-tab/popular-mcp-servers";
import {
  type McpServerKind,
  useMcpServerDialogState,
} from "@/components/soul-tools/mcp-tab/use-mcp-server-dialog-state";
import { useSyncMcpServerMutation } from "@/hooks/use-resource-mutations";
import { formatError } from "@/lib/client";

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

const NEW_KINDS = [
  { id: "signin", label: "Hosted", tag: "OAuth" },
  { id: "http", label: "HTTP", tag: "Header" },
  { id: "stdio", label: "Command", tag: "Local" },
] as const satisfies readonly {
  id: McpServerKind;
  label: string;
  tag: string;
}[];

function RailHeading({ children }: { children: string }) {
  return (
    <p className="px-2.5 pt-4 pb-1 font-medium text-[0.6875rem] text-muted-foreground uppercase tracking-wide">
      {children}
    </p>
  );
}

function RailItem({
  active,
  disabled,
  icon,
  label,
  onClick,
  tag,
}: {
  active: boolean;
  disabled: boolean;
  icon?: ReactNode;
  label: string;
  onClick: () => void;
  tag: string;
}) {
  return (
    <button
      aria-pressed={active}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-muted-foreground text-sm transition-colors hover:text-foreground",
        active && "bg-background font-medium text-foreground shadow-xs"
      )}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <span className="flex min-w-0 items-center gap-2">
        {icon}
        <span className="truncate">{label}</span>
      </span>
      <span className="shrink-0 font-normal text-muted-foreground/70 text-xs">
        {tag}
      </span>
    </button>
  );
}

function pickNewKind(
  state: McpServerDialogState,
  kind: McpServerKind,
  clearPreset: boolean
) {
  if (clearPreset) {
    state.setName("");
    state.setUrl("");
  }

  state.selectKind(kind);
}

function NewRailSection({
  activeKind,
  disabled,
  onPick,
}: {
  activeKind: McpServerKind | null;
  disabled: boolean;
  onPick: (kind: McpServerKind) => void;
}) {
  return (
    <>
      <RailHeading>New</RailHeading>
      {NEW_KINDS.map((item) => (
        <RailItem
          active={activeKind === item.id}
          disabled={disabled}
          key={item.id}
          label={item.label}
          onClick={() => onPick(item.id)}
          tag={item.tag}
        />
      ))}
    </>
  );
}

type PopularServer = (typeof POPULAR_SERVERS)[number];

function PopularRailSection({
  activeUrl,
  disabled,
  onPick,
  servers,
}: {
  activeUrl: string | null;
  disabled: boolean;
  onPick: (server: PopularServer) => void;
  servers: readonly PopularServer[];
}) {
  if (servers.length === 0) {
    return null;
  }

  return (
    <>
      <RailHeading>Popular</RailHeading>
      {servers.map((item) => (
        <RailItem
          active={activeUrl === item.url}
          disabled={disabled}
          icon={
            <svg
              aria-hidden="true"
              className="size-4 shrink-0"
              fill="currentColor"
              viewBox={item.viewBox}
            >
              <path d={item.path} />
            </svg>
          }
          key={item.name}
          label={item.name}
          onClick={() => onPick(item)}
          tag="OAuth"
        />
      ))}
    </>
  );
}

function McpRegisteredPane({
  busy,
  onAssign,
  onOpenChange,
  onTestConnection,
  server,
}: {
  busy: boolean;
  onAssign: (serverId: string) => void;
  onOpenChange: (open: boolean) => void;
  onTestConnection?: (server: McpServerSummary) => void;
  server: McpServerSummary;
}) {
  const sync = useSyncMcpServerMutation();
  const disabled = busy || sync.isPending;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h3 className="font-semibold text-base">{server.name}</h3>
        <p className="text-muted-foreground text-sm">
          {server.transport} · {server.toolCount} tool
          {server.toolCount === 1 ? "" : "s"}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={disabled}
          onClick={() => sync.mutate(server.id)}
          size="sm"
          type="button"
          variant="outline"
        >
          {sync.isPending ? <Spinner className="size-4" /> : "Sync tools"}
        </Button>
        {onTestConnection ? (
          <Button
            disabled={disabled}
            onClick={() => onTestConnection(server)}
            size="sm"
            type="button"
            variant="outline"
          >
            Test connection
          </Button>
        ) : null}
      </div>
      {sync.error ? (
        <p className="text-destructive text-sm" role="alert">
          {formatError(sync.error)}
        </p>
      ) : null}
      <DialogFooter className="mt-auto gap-3 border-t-0 bg-transparent p-0 sm:justify-end">
        <Button
          onClick={() => onOpenChange(false)}
          type="button"
          variant="outline"
        >
          Cancel
        </Button>
        <Button
          disabled={disabled}
          onClick={() => onAssign(server.id)}
          type="button"
        >
          {busy ? <Spinner className="size-4" /> : "Add server"}
        </Button>
      </DialogFooter>
    </div>
  );
}

function McpServerDialogRail({
  availableServers,
  busy,
  onSelect,
  registered,
  selectedId,
  state,
}: {
  availableServers?: McpServerSummary[];
  busy: boolean;
  onSelect: (serverId: string | null) => void;
  registered: McpServerSummary[];
  selectedId: string | null;
  state: McpServerDialogState;
}) {
  const popular = unregisteredPopularServers(availableServers);

  const popularActive =
    state.kind === "signin" && popular.some((item) => item.url === state.url);

  const railKind = selectedId || popularActive ? null : state.kind;

  return (
    <nav
      aria-label="Add MCP server"
      className="flex max-h-48 shrink-0 flex-col gap-0.5 overflow-y-auto bg-muted/50 p-3 sm:max-h-none sm:w-56"
    >
      <DialogTitle className="px-2.5 pb-2">Add MCP server</DialogTitle>
      <DialogDescription className="sr-only">
        Pick a server type to create, or add a registered server.
      </DialogDescription>
      <NewRailSection
        activeKind={railKind}
        disabled={state.formDisabled}
        onPick={(kind) => {
          onSelect(null);
          pickNewKind(state, kind, popularActive);
        }}
      />
      <PopularRailSection
        activeUrl={
          selectedId === null && state.kind === "signin" ? state.url : null
        }
        disabled={state.formDisabled}
        onPick={(item) => {
          onSelect(null);
          state.selectKind("signin");
          state.setName(item.name);
          state.setUrl(item.url);
        }}
        servers={popular}
      />
      {registered.length > 0 ? (
        <>
          <RailHeading>Registered</RailHeading>
          {registered.map((item) => (
            <RailItem
              active={selectedId === item.id}
              disabled={busy}
              key={item.id}
              label={item.name}
              onClick={() => onSelect(item.id)}
              tag={item.transport}
            />
          ))}
        </>
      ) : null}
      <Button
        className="mt-auto justify-start text-muted-foreground hover:text-foreground sm:mt-auto"
        disabled={state.formDisabled}
        onClick={() => {
          onSelect(null);
          state.openImportDialog();
        }}
        size="sm"
        type="button"
        variant="ghost"
      >
        <CodeIcon aria-hidden />
        Import JSON
      </Button>
    </nav>
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
  onTestConnection,
}: {
  open: boolean;
  busy: boolean;
  server?: McpServerSummary | null;
  availableServers?: McpServerSummary[];
  error?: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (request: CreateMcpServerRequest) => Promise<void>;
  onAssign?: (serverId: string) => void;
  onTestConnection?: (server: McpServerSummary) => void;
}) {
  const state = useMcpServerDialogState({ busy, onSubmit, open, server });
  const registered = onAssign ? (availableServers ?? []) : [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [prevOpen, setPrevOpen] = useState(open);

  if (open !== prevOpen) {
    setPrevOpen(open);
    setSelectedId(null);
  }

  const selectedServer =
    registered.find((item) => item.id === selectedId) ?? null;

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
          <DialogContent className="top-4 -translate-y-0 gap-0 overflow-hidden p-0 sm:top-[8dvh] sm:h-[36rem] sm:max-h-[84dvh] sm:max-w-3xl">
            <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
              <McpServerDialogRail
                availableServers={availableServers}
                busy={busy}
                onSelect={setSelectedId}
                registered={registered}
                selectedId={selectedServer?.id ?? null}
                state={state}
              />
              <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
                {error ? (
                  <p className="text-destructive text-sm" role="alert">
                    {error}
                  </p>
                ) : null}
                {selectedServer && onAssign ? (
                  <McpRegisteredPane
                    busy={busy}
                    onAssign={onAssign}
                    onOpenChange={onOpenChange}
                    onTestConnection={onTestConnection}
                    server={selectedServer}
                  />
                ) : (
                  <McpServerDialogCreateForm
                    busy={busy}
                    onOpenChange={onOpenChange}
                    showKindPicker={false}
                    state={state}
                    submitLabel="Add server"
                  />
                )}
              </div>
            </div>
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
