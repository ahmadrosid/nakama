import type {
  CachedMcpToolSummary,
  CreateMcpServerRequest,
  McpHttpConfig,
  McpServerSummary,
  McpStdioConfig,
  McpTransport,
} from "@tinyclaw/core/contract";
import {
  BlocksIcon,
  EllipsisVerticalIcon,
  EyeIcon,
  PencilIcon,
  PlugIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import {
  useEffect,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { McpToolLabels, McpToolList } from "@/components/soul-tools/McpToolList";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useMcpServerDetailQuery, useMcpServersQuery } from "@/hooks/use-app-queries";
import {
  useConnectMcpServerMutation,
  useCreateMcpServerMutation,
  useDeleteMcpServerMutation,
  useSyncMcpServerMutation,
  useUpdateMcpServerMutation,
} from "@/hooks/use-resource-mutations";
import { client, formatError } from "@/lib/client";
import {
  parseMcpConfigJson,
  type ParsedMcpServerImport,
} from "@/lib/mcp-config-import";
import { cn } from "@/lib/utils";

const sectionClass = "rounded-md border border-border bg-card";
const REDACTED_SECRET_VALUE = "••••••••";

type McpHeaderRow = {
  key: string;
  value: string;
};

function emptyHeaderRow(): McpHeaderRow {
  return { key: "", value: "" };
}

export function McpTab() {
  const { data: servers = [], isLoading, error } = useMcpServersQuery();
  const createMutation = useCreateMcpServerMutation();
  const updateMutation = useUpdateMcpServerMutation();
  const deleteMutation = useDeleteMcpServerMutation();
  const connectMutation = useConnectMcpServerMutation();
  const syncMutation = useSyncMcpServerMutation();
  const [actionError, setActionError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editServerId, setEditServerId] = useState<string | null>(null);
  const [detailServerId, setDetailServerId] = useState<string | null>(null);
  const editServer = servers.find((server) => server.id === editServerId) ?? null;
  const detailServer = servers.find((server) => server.id === detailServerId) ?? null;

  const loading = isLoading && servers.length === 0;
  const busy =
    createMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending ||
    connectMutation.isPending ||
    syncMutation.isPending;
  const errorMessage = actionError ?? (error ? formatError(error) : null);

  async function handleDelete(server: McpServerSummary) {
    if (
      !window.confirm(
        `Delete MCP server "${server.name}"? This removes it from every profile.`,
      )
    ) {
      return;
    }

    setActionError(null);

    try {
      await deleteMutation.mutateAsync(server.id);
      setDetailServerId((current) => (current === server.id ? null : current));
    } catch (err) {
      setActionError(formatError(err));
    }
  }

  async function handleConnect(serverId: string) {
    setActionError(null);

    try {
      await connectMutation.mutateAsync(serverId);
      setDetailServerId(serverId);
    } catch (err) {
      setActionError(formatError(err));
    }
  }

  async function handleSync(serverId: string) {
    setActionError(null);

    try {
      await syncMutation.mutateAsync(serverId);
      setDetailServerId(serverId);
    } catch (err) {
      setActionError(formatError(err));
    }
  }

  if (loading) {
    return <PageState message="Loading MCP servers…" />;
  }

  return (
    <>
      {errorMessage ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {errorMessage}
        </p>
      ) : null}

      <section className={cn(sectionClass, "overflow-hidden")}>
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
          <div className="min-w-0 flex-1">
            <h2 className="type-section-title">MCP servers</h2>
            <p className="type-body mt-1 text-xs">
              {servers.length === 0
                ? "No MCP servers registered yet"
                : `${servers.length} registered`}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
              <PlusIcon className="size-4" aria-hidden />
              Add server
            </Button>
          </div>
        </div>

        {servers.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">
            Register MCP servers here, then assign them to profiles on the Profiles page.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {servers.map((server) => (
              <li key={server.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{server.name}</p>
                    {server.lastError ? (
                      <p className="mt-1 text-xs text-destructive">{server.lastError}</p>
                    ) : null}
                    <McpToolLabels
                      serverId={server.id}
                      toolCount={server.toolCount}
                      connected={server.status === "connected"}
                      onShowAll={() => setDetailServerId(server.id)}
                    />
                  </div>

                  <McpServerActions
                    server={server}
                    busy={busy}
                    onViewTools={() => setDetailServerId(server.id)}
                    onEdit={() => setEditServerId(server.id)}
                    onConnect={() => void handleConnect(server.id)}
                    onSync={() => void handleSync(server.id)}
                    onDelete={() => void handleDelete(server)}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <McpServerToolsDialog
        server={detailServer}
        open={detailServerId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDetailServerId(null);
          }
        }}
      />

      <McpServerDialog
        open={createOpen}
        busy={createMutation.isPending}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) {
            setActionError(null);
          }
        }}
        onSubmit={async (request) => {
          setActionError(null);

          try {
            const response = await createMutation.mutateAsync({ ...request, connect: true });
            setCreateOpen(false);
            setDetailServerId(response.server.id);
          } catch (err) {
            const message = formatError(err);
            setActionError(message);
            throw new Error(message);
          }
        }}
      />

      <McpServerDialog
        server={editServer}
        open={editServerId !== null}
        busy={updateMutation.isPending || connectMutation.isPending}
        onOpenChange={(open) => {
          if (!open) {
            setEditServerId(null);
            setActionError(null);
          }
        }}
        onSubmit={async (request) => {
          if (!editServer) {
            return;
          }

          setActionError(null);

          try {
            const wasConnected = editServer.status === "connected";
            const { connect: _connect, ...updateRequest } = request;
            await updateMutation.mutateAsync({
              serverId: editServer.id,
              request: updateRequest,
            });
            setEditServerId(null);

            if (wasConnected) {
              await connectMutation.mutateAsync(editServer.id);
            }
          } catch (err) {
            const message = formatError(err);
            setActionError(message);
            throw new Error(message);
          }
        }}
      />
    </>
  );
}

function McpServerActions({
  server,
  busy,
  onViewTools,
  onEdit,
  onConnect,
  onSync,
  onDelete,
}: {
  server: McpServerSummary;
  busy: boolean;
  onViewTools: () => void;
  onEdit: () => void;
  onConnect: () => void;
  onSync: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`View tools for ${server.name}`}
        onClick={onViewTools}
      >
        <EyeIcon className="size-4" aria-hidden />
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={busy}
              aria-label={`Actions for ${server.name}`}
            />
          }
        >
          <EllipsisVerticalIcon className="size-4" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-40">
          {server.status !== "connected" ? (
            <DropdownMenuItem disabled={busy} onClick={onConnect}>
              <PlugIcon aria-hidden />
              Connect
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem disabled={busy} onClick={onEdit}>
            <PencilIcon aria-hidden />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem disabled={busy} onClick={onSync}>
            <RefreshCwIcon aria-hidden />
            Sync tools
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" disabled={busy} onClick={onDelete}>
            <Trash2Icon aria-hidden />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function McpServerToolsDialog({
  server,
  open,
  onOpenChange,
}: {
  server: McpServerSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: detail, isLoading, error } = useMcpServerDetailQuery(
    open && server ? server.id : null,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(85dvh,42rem)] max-h-[min(90dvh,85vh)] w-[calc(100%-1.5rem)] flex-col gap-4 overflow-hidden p-4 sm:max-w-3xl sm:gap-6 sm:p-6">
        {server ? (
          <>
            <DialogHeader className="gap-2 pr-8 sm:gap-3">
              <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
                <span
                  className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted/30 text-muted-foreground"
                  aria-hidden
                >
                  <BlocksIcon className="size-4" />
                </span>
                {server.name}
              </DialogTitle>
              <DialogDescription className="leading-relaxed">
                Tools exposed by this MCP server and available to assigned profiles.
              </DialogDescription>
              {detail?.transport === "stdio" && "command" in detail.config ? (
                <p
                  className="truncate font-mono text-xs text-muted-foreground"
                  title={detail.config.command}
                >
                  {detail.config.command}
                  {detail.config.args?.length ? ` ${detail.config.args.join(" ")}` : ""}
                </p>
              ) : detail?.transport === "http" && "url" in detail.config ? (
                <p className="truncate font-mono text-xs text-muted-foreground" title={detail.config.url}>
                  {detail.config.url}
                </p>
              ) : isLoading ? (
                <p className="text-xs text-muted-foreground">Loading server details…</p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <StatusBadge status={server.status} />
                <span className="text-xs text-muted-foreground">
                  {server.toolCount} tool{server.toolCount === 1 ? "" : "s"}
                </span>
              </div>
            </DialogHeader>

            <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
              {isLoading && !detail ? (
                <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                  <Spinner className="size-4" />
                  Loading tools…
                </div>
              ) : error ? (
                <p className="rounded-md bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
                  {formatError(error)}
                </p>
              ) : !detail || detail.cachedTools.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {server.status === "connected"
                    ? "Connected, but no tools were discovered. Try Sync tools from the server menu."
                    : "No cached tools yet. Connect and sync this server."}
                </p>
              ) : (
                <McpToolList tools={detail.cachedTools} />
              )}
            </div>

            <DialogFooter className="mx-0 mb-0 shrink-0 gap-3 border-t-0 bg-transparent p-0 pt-2 sm:justify-end">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function McpServerDialog({
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
  const isEdit = server != null;
  const { data: detail, isLoading: loadingDetail } = useMcpServerDetailQuery(
    open && server ? server.id : null,
  );
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<McpTransport>("http");
  const [url, setUrl] = useState("");
  const [headers, setHeaders] = useState<McpHeaderRow[]>([emptyHeaderRow()]);
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState<string[]>([]);
  const [env, setEnv] = useState<McpHeaderRow[]>([emptyHeaderRow()]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    toolCount: number;
    message: string;
    tools: CachedMcpToolSummary[];
  } | null>(null);

  const idPrefix = server ? `mcp-edit-${server.id}` : "mcp-create";
  const loadingForm = isEdit && loadingDetail && !detail;
  const formDisabled = busy || testing || loadingForm;
  const activeTransport = resolveFormTransport(transport, command, url);
  const canSubmit =
    name.trim().length > 0 &&
    !loadingForm &&
    (activeTransport === "http" ? url.trim().length > 0 : command.trim().length > 0);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (!server) {
      setName("");
      setTransport("http");
      setUrl("");
      setHeaders([emptyHeaderRow()]);
      setCommand("");
      setArgs([]);
      setEnv([emptyHeaderRow()]);
      setSubmitError(null);
      setImportMessage(null);
      setTestResult(null);
      setTesting(false);
      return;
    }

    if (!detail) {
      return;
    }

    setName(detail.name);
    setTransport(detail.transport);
    setSubmitError(null);
    setImportMessage(null);
    setTestResult(null);
    setTesting(false);

    if (detail.transport === "stdio") {
      const stdioConfig = detail.config as McpStdioConfig;
      setCommand(stdioConfig.command);
      setArgs(stdioConfig.args ?? []);
      setEnv(recordToHeaderRows(stdioConfig.env));
      setUrl("");
      setHeaders([emptyHeaderRow()]);
      return;
    }

    const httpConfig = detail.config as McpHttpConfig;
    setUrl(httpConfig.url);
    setHeaders(recordToHeaderRows(httpConfig.headers));
    setCommand("");
    setArgs([]);
    setEnv([emptyHeaderRow()]);
  }, [open, server, detail]);

  function buildRequest(): CreateMcpServerRequest {
    const activeTransport = resolveFormTransport(transport, command, url);

    if (activeTransport === "stdio") {
      return {
        name: name.trim(),
        transport: "stdio",
        config: {
          command: command.trim(),
          args: argsToArray(args),
          env: headersToRecord(env, isEdit),
        },
        connect: false,
        ...(isEdit && server ? { serverId: server.id } : {}),
      };
    }

    return {
      name: name.trim(),
      transport: "http",
      config: {
        url: url.trim(),
        headers: headersToRecord(headers, isEdit),
      },
      connect: false,
      ...(isEdit && server ? { serverId: server.id } : {}),
    };
  }

  async function handleTestConnection() {
    if (!canSubmit) {
      return;
    }

    setTesting(true);
    setSubmitError(null);
    setTestResult(null);

    try {
      const result = await client.testMcpServer(buildRequest());

      if (result.ok) {
        setTestResult({
          ok: true,
          toolCount: result.toolCount,
          tools: result.tools,
          message:
            result.toolCount === 0
              ? "Connected, but no tools were returned."
              : `Connected. Found ${result.toolCount} tool${result.toolCount === 1 ? "" : "s"}.`,
        });
        return;
      }

      setTestResult({
        ok: false,
        toolCount: 0,
        tools: [],
        message: result.error ?? "Connection test failed.",
      });
    } catch (error) {
      setTestResult({
        ok: false,
        toolCount: 0,
        tools: [],
        message: formatError(error),
      });
    } finally {
      setTesting(false);
    }
  }

  function applyImportedServer(imported: ParsedMcpServerImport) {
    if (isEdit && imported.transport !== transport) {
      setImportMessage(
        `Imported config uses ${imported.transport}, but this server uses ${transport}.`,
      );
      return;
    }

    setName(imported.name);
    setTransport(imported.transport);

    if (imported.transport === "stdio") {
      const stdioConfig = imported.config as McpStdioConfig;
      setCommand(stdioConfig.command);
      setArgs(stdioConfig.args ?? []);
      setEnv(recordToHeaderRows(stdioConfig.env));
      setUrl("");
      setHeaders([emptyHeaderRow()]);
    } else {
      const httpConfig = imported.config as McpHttpConfig;
      setUrl(httpConfig.url);
      setHeaders(recordToHeaderRows(httpConfig.headers));
      setCommand("");
      setArgs([]);
      setEnv([emptyHeaderRow()]);
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLFormElement>) {
    if (formDisabled) {
      return;
    }

    const text = event.clipboardData.getData("text/plain");
    const result = parseMcpConfigJson(text);

    if (result === null) {
      return;
    }

    event.preventDefault();

    if (!result.ok) {
      setImportMessage(result.error);
      setTestResult(null);
      return;
    }

    applyImportedServer(result.server);
    setImportMessage(
      result.importedCount > 1
        ? `Imported "${result.server.name}". Only the first of ${result.importedCount} servers was applied.`
        : `Imported "${result.server.name}" from pasted config.`,
    );
    setSubmitError(null);
    setTestResult(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    if (!canSubmit || busy) {
      return;
    }

    setSubmitError(null);

    try {
      await onSubmit(buildRequest());
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : formatError(error));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-6 p-6 sm:max-w-lg">
        <form className="space-y-6" onSubmit={handleSubmit} onPaste={handlePaste}>
          <DialogHeader className="gap-2">
            <DialogTitle>{isEdit ? "Edit MCP server" : "Add MCP server"}</DialogTitle>
            <DialogDescription>
              {isEdit
                ? transport === "stdio"
                  ? "Update the command, args, or environment. Leave values blank to keep the current ones."
                  : "Update the server URL or headers. Leave values blank to keep the current ones."
                : "Register an HTTP or command-based server, then assign it to profiles on the Profiles page. Paste MCP JSON anywhere in this form to import."}
            </DialogDescription>
          </DialogHeader>

          {importMessage ? (
            <p
              className="rounded-md bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground"
              role="status"
            >
              {importMessage}
            </p>
          ) : null}

          {loadingForm ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              Loading server…
            </div>
          ) : (
          <div className="space-y-5">
            <McpFormField label="Transport">
              <div
                role="tablist"
                aria-label="MCP transport"
                className="segmented-control w-full"
              >
                {(
                  [
                    { id: "http" as const, label: "HTTP" },
                    { id: "stdio" as const, label: "Command" },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    id={`${idPrefix}-transport-${item.id}`}
                    role="tab"
                    aria-selected={transport === item.id}
                    aria-controls={`${idPrefix}-transport-panel-${item.id}`}
                    data-active={transport === item.id || undefined}
                    disabled={formDisabled || isEdit}
                    className="segmented-control-item"
                    onClick={() => {
                      setTransport(item.id);
                      setTestResult(null);
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </McpFormField>

            <McpFormField label="Name" htmlFor={`${idPrefix}-name`}>
              <Input
                id={`${idPrefix}-name`}
                value={name}
                disabled={formDisabled}
                autoFocus
                onChange={(event) => {
                  setName(event.target.value);
                  setTestResult(null);
                }}
                placeholder="server name"
              />
            </McpFormField>

            <div
              id={`${idPrefix}-transport-panel-${transport}`}
              role="tabpanel"
              aria-labelledby={`${idPrefix}-transport-${transport}`}
              className="space-y-5"
            >
            {transport === "http" ? (
              <>
                <McpFormField label="URL" htmlFor={`${idPrefix}-url`}>
                  <Input
                    id={`${idPrefix}-url`}
                    value={url}
                    disabled={formDisabled}
                    className="font-mono text-sm"
                    onChange={(event) => {
                      const nextUrl = event.target.value;
                      setUrl(nextUrl);
                      if (nextUrl.trim()) {
                        setTransport("http");
                      }
                      setTestResult(null);
                    }}
                    placeholder="https://example.com/mcp"
                  />
                </McpFormField>

                <McpFormField label="Headers" hint="Optional">
                  <McpHeadersEditor
                    headers={headers}
                    isEdit={isEdit}
                    disabled={formDisabled}
                    onChange={(nextHeaders) => {
                      setHeaders(nextHeaders);
                      setTestResult(null);
                    }}
                  />
                </McpFormField>
              </>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <McpFormField label="Command" htmlFor={`${idPrefix}-command`}>
                    <Input
                      id={`${idPrefix}-command`}
                      value={command}
                      disabled={formDisabled}
                      className="font-mono text-sm"
                      onChange={(event) => {
                        const nextCommand = event.target.value;
                        setCommand(nextCommand);
                        if (nextCommand.trim()) {
                          setTransport("stdio");
                        }
                        setTestResult(null);
                      }}
                      placeholder="npx"
                    />
                  </McpFormField>

                  <McpFormField label="Arguments" hint="Optional">
                    <McpArgsEditor
                      args={args}
                      disabled={formDisabled}
                      inputId={`${idPrefix}-args`}
                      onChange={(nextArgs) => {
                        setArgs(nextArgs);
                        setTestResult(null);
                      }}
                    />
                  </McpFormField>
                </div>

                <McpFormField label="Environment" hint="Optional">
                  <McpHeadersEditor
                    headers={env}
                    isEdit={isEdit}
                    disabled={formDisabled}
                    keyLabel="Variable"
                    valueLabel="Value"
                    valuePlaceholder={isEdit ? "Leave blank to keep" : "secret-value"}
                    onChange={(nextEnv) => {
                      setEnv(nextEnv);
                      setTestResult(null);
                    }}
                  />
                </McpFormField>

              </>
            )}
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              disabled={formDisabled || !canSubmit}
              onClick={() => void handleTestConnection()}
            >
              {testing ? <Spinner className="size-4" /> : "Test connection"}
            </Button>

            {testResult ? (
              <div className="space-y-3">
                <p
                  className={cn(
                    "rounded-md px-3 py-2.5 text-sm",
                    testResult.ok
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      : "bg-destructive/10 text-destructive",
                  )}
                  role="status"
                >
                  {testResult.message}
                </p>

                {testResult.ok && testResult.tools.length > 0 ? (
                  <div className="rounded-md border border-border bg-muted/20 p-3">
                    <p className="mb-3 text-xs font-medium text-foreground">
                      Discovered tools ({testResult.tools.length})
                    </p>
                    <McpToolList tools={testResult.tools} />
                  </div>
                ) : null}
              </div>
            ) : null}

            {submitError ? (
              <p
                className="rounded-md bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
                role="alert"
              >
                {submitError}
              </p>
            ) : null}
          </div>
          )}

          <DialogFooter className="gap-3 border-t-0 bg-transparent p-3 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={formDisabled}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={formDisabled || !canSubmit}>
              {busy ? (
                <Spinner className="size-4" />
              ) : isEdit ? (
                "Save changes"
              ) : (
                "Add server"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function McpArgsEditor({
  args,
  disabled,
  inputId,
  onChange,
}: {
  args: string[];
  disabled?: boolean;
  inputId?: string;
  onChange: (args: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function addArg(value: string) {
    const trimmed = value.trim();

    if (!trimmed) {
      return;
    }

    onChange([...args, trimmed]);
    setDraft("");
  }

  function removeArg(index: number) {
    onChange(args.filter((_, argIndex) => argIndex !== index));
  }

  function handleDraftChange(value: string) {
    if (!value.includes(",")) {
      setDraft(value);
      return;
    }

    const segments = value.split(",");
    const remainder = segments.pop() ?? "";
    const nextArgs = [...args];

    for (const segment of segments) {
      const trimmed = segment.trim();

      if (trimmed) {
        nextArgs.push(trimmed);
      }
    }

    if (nextArgs.length !== args.length) {
      onChange(nextArgs);
    }

    setDraft(remainder);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addArg(draft);
      return;
    }

    if (event.key === "Backspace" && !draft && args.length > 0) {
      onChange(args.slice(0, -1));
    }
  }

  return (
    <div
      className={cn(
        "no-scrollbar flex h-8 w-full min-w-0 items-center gap-1 overflow-x-auto rounded-lg border border-input bg-transparent px-2.5 py-1 font-mono text-sm transition-colors outline-none focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
        disabled &&
          "pointer-events-none cursor-not-allowed bg-input/50 opacity-50 dark:disabled:bg-input/80",
      )}
    >
      {args.map((arg, index) => (
        <span
          key={`${index}-${arg}`}
          className="inline-flex h-5 max-w-full shrink-0 items-center gap-0.5 rounded-md border border-border bg-muted/50 pl-1.5 pr-0.5 text-xs text-foreground"
        >
          <span className="truncate">{arg}</span>
          <button
            type="button"
            disabled={disabled}
            className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none"
            aria-label={`Remove argument ${arg}`}
            onClick={() => removeArg(index)}
          >
            <XIcon className="size-2.5" aria-hidden />
          </button>
        </span>
      ))}
      <input
        id={inputId}
        type="text"
        value={draft}
        disabled={disabled}
        className="min-w-[4rem] flex-1 border-0 bg-transparent p-0 font-mono text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        placeholder={args.length === 0 ? "-y" : "Add argument"}
        aria-label="Add argument"
        onChange={(event) => handleDraftChange(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => addArg(draft)}
      />
    </div>
  );
}

function McpHeadersEditor({
  headers,
  isEdit = false,
  disabled,
  keyLabel = "Header",
  valueLabel = "Value",
  valuePlaceholder,
  onChange,
}: {
  headers: McpHeaderRow[];
  isEdit?: boolean;
  disabled?: boolean;
  keyLabel?: string;
  valueLabel?: string;
  valuePlaceholder?: string;
  onChange: (headers: McpHeaderRow[]) => void;
}) {
  function updateRow(index: number, field: keyof McpHeaderRow, value: string) {
    onChange(
      headers.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [field]: value } : row,
      ),
    );
  }

  function removeRow(index: number) {
    onChange(headers.filter((_, rowIndex) => rowIndex !== index));
  }

  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {headers.map((row, index) => (
          <li key={index} className="flex items-start gap-2">
            <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
              <Input
                value={row.key}
                disabled={disabled}
                className="font-mono text-sm"
                aria-label={`${keyLabel} name ${index + 1}`}
                placeholder={keyLabel === "Header" ? "Authorization" : "API_KEY"}
                onChange={(event) => updateRow(index, "key", event.target.value)}
              />
              <Input
                value={row.value}
                disabled={disabled}
                className="font-mono text-sm"
                aria-label={`${valueLabel} ${index + 1}`}
                placeholder={
                  valuePlaceholder ?? (isEdit ? "Leave blank to keep" : "Bearer token")
                }
                onChange={(event) => updateRow(index, "value", event.target.value)}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={disabled || headers.length <= 1}
              className="mt-0.5 shrink-0"
              aria-label={`Remove header ${index + 1}`}
              onClick={() => removeRow(index)}
            >
              <Trash2Icon className="size-4" aria-hidden />
            </Button>
          </li>
        ))}
      </ul>

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => onChange([...headers, emptyHeaderRow()])}
      >
        <PlusIcon className="size-4" aria-hidden />
        Add header
      </Button>
    </div>
  );
}

function McpFormField({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: ReactNode;
}) {
  const LabelTag = htmlFor ? "label" : "span";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <LabelTag className="text-xs text-muted-foreground" {...(htmlFor ? { htmlFor } : {})}>
          {label}
        </LabelTag>
        {hint ? <span className="text-xs text-muted-foreground/80">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

function StatusBadge({ status }: { status: McpServerSummary["status"] }) {
  const label =
    status === "connected" ? "Connected" : status === "error" ? "Error" : "Disconnected";

  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs",
        status === "connected" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        status === "error" && "bg-destructive/10 text-destructive",
        status === "disconnected" && "bg-muted text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}

function PageState({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-card p-6 text-sm text-muted-foreground">
      <Spinner className="size-4" />
      {message}
    </div>
  );
}

function recordToHeaderRows(headers?: Record<string, string>): McpHeaderRow[] {
  if (!headers || Object.keys(headers).length === 0) {
    return [emptyHeaderRow()];
  }

  return Object.entries(headers).map(([key, value]) => ({
    key,
    value: value === REDACTED_SECRET_VALUE ? "" : value,
  }));
}

function resolveFormTransport(
  transport: McpTransport,
  command: string,
  url: string,
): McpTransport {
  if (command.trim()) {
    return "stdio";
  }

  if (url.trim()) {
    return "http";
  }

  return transport;
}

function argsToArray(values: string[]): string[] | undefined {
  const items = values.map((value) => value.trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function headersToRecord(
  rows: McpHeaderRow[],
  forUpdate = false,
): Record<string, string> | undefined {
  const headers: Record<string, string> = {};

  for (const row of rows) {
    const key = row.key.trim();
    const value = row.value.trim();

    if (!key) {
      continue;
    }

    if (forUpdate) {
      headers[key] = value;
      continue;
    }

    if (value) {
      headers[key] = value;
    }
  }

  return Object.keys(headers).length > 0 ? headers : undefined;
}
