import type {
  CachedMcpToolSummary,
  CreateMcpServerRequest,
  McpHttpConfig,
  McpServerSummary,
  McpStdioConfig,
  McpTransport,
} from "@nakama/core/contract";
import { BracesIcon } from "lucide-react";
import { useEffect, useState, type ClipboardEvent, type FormEvent } from "react";
import {
  McpArgsEditor,
  McpFormField,
  McpHeadersEditor,
} from "@/components/soul-tools/mcp-tab/McpFormEditors";
import {
  argsToArray,
  emptyHeaderRow,
  headersToRecord,
  recordToHeaderRows,
  resolveFormTransport,
  type McpHeaderRow,
} from "@/components/soul-tools/mcp-tab/shared";
import { McpToolList } from "@/components/soul-tools/McpToolList";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useMcpServerDetailQuery } from "@/hooks/use-app-queries";
import { client, formatError } from "@/lib/client";
import {
  parseMcpConfigJson,
  type ParsedMcpServerImport,
} from "@/lib/mcp-config-import";
import { cn } from "@/lib/utils";

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
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    toolCount: number;
    message: string;
    tools: CachedMcpToolSummary[];
  } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importDraft, setImportDraft] = useState("");
  const [importError, setImportError] = useState<string | null>(null);

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
      setImportOpen(false);
      setImportDraft("");
      setImportError(null);
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

  function tryImportJson(text: string): string | null {
    const result = parseMcpConfigJson(text);

    if (result === null) {
      return "Not a valid MCP server JSON config.";
    }

    if (!result.ok) {
      return result.error;
    }

    if (isEdit && result.server.transport !== transport) {
      return `Imported config uses ${result.server.transport}, but this server uses ${transport}.`;
    }

    applyImportedServer(result.server);
    setSubmitError(null);
    setTestResult(null);
    return null;
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
    tryImportJson(text);
  }

  function openImportDialog() {
    setImportDraft("");
    setImportError(null);
    setImportOpen(true);
  }

  function handleImportApply() {
    const error = tryImportJson(importDraft);

    if (error) {
      setImportError(error);
      setTestResult(null);
      return;
    }

    setImportOpen(false);
    setImportDraft("");
    setImportError(null);
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
    <>
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
                : "Register an HTTP or command-based server, then assign it to profiles on the Profiles page."}
            </DialogDescription>
          </DialogHeader>

          {loadingForm ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              Loading server…
            </div>
          ) : (
          <div className="space-y-5">
            <McpFormField
              label="Transport"
              action={
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={formDisabled}
                  className="text-muted-foreground hover:text-foreground"
                  onClick={openImportDialog}
                >
                  <BracesIcon aria-hidden />
                  Import JSON
                </Button>
              }
            >
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

    <Dialog open={importOpen} onOpenChange={setImportOpen}>
      <DialogContent className="gap-5 p-6 sm:max-w-lg">
        <DialogHeader className="gap-2">
          <DialogTitle>Import MCP config</DialogTitle>
          <DialogDescription>
            Paste JSON from your MCP client config. The first server entry will fill this form.
          </DialogDescription>
        </DialogHeader>

        <Textarea
          value={importDraft}
          disabled={formDisabled}
          autoFocus
          rows={10}
          className="min-h-48 font-mono text-sm"
          placeholder={`{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "some-mcp-package"]
    }
  }
}`}
          onChange={(event) => {
            setImportDraft(event.target.value);
            if (importError) {
              setImportError(null);
            }
          }}
        />

        {importError ? (
          <p
            className="rounded-md bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
            role="alert"
          >
            {importError}
          </p>
        ) : null}

        <DialogFooter className="gap-3 border-t-0 bg-transparent p-0 sm:justify-end">
          <Button type="button" variant="outline" onClick={() => setImportOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={formDisabled || !importDraft.trim()}
            onClick={handleImportApply}
          >
            Apply to form
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
