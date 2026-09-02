import type {
  CachedMcpToolSummary,
  CreateMcpServerRequest,
  McpHttpConfig,
  McpServerSummary,
  McpStdioConfig,
  McpTransport,
} from "@nakama/core/contract";
import { type ClipboardEvent, useState } from "react";
import {
  argsToArray,
  emptyHeaderRow,
  headersToRecord,
  type McpHeaderRow,
  recordToHeaderRows,
  resolveFormTransport,
} from "@/components/soul-tools/mcp-tab/shared";
import { useMcpServerDetailQuery } from "@/hooks/use-app-queries";
import { client, formatError } from "@/lib/client";
import {
  type ParsedMcpServerImport,
  parseMcpConfigJson,
} from "@/lib/mcp-config-import";

type FormSetters = {
  setArgs: (value: string[]) => void;
  setCommand: (value: string) => void;
  setEnv: (value: McpHeaderRow[]) => void;
  setHeaders: (value: McpHeaderRow[]) => void;
  setImportDraft: (value: string) => void;
  setImportError: (value: string | null) => void;
  setImportOpen: (value: boolean) => void;
  setName: (value: string) => void;
  setSubmitError: (value: string | null) => void;
  setTestResult: (
    value: {
      ok: boolean;
      toolCount: number;
      message: string;
      tools: CachedMcpToolSummary[];
    } | null
  ) => void;
  setTesting: (value: boolean) => void;
  setTransport: (value: McpTransport) => void;
  setUrl: (value: string) => void;
};

function resetClosedImportState(setters: FormSetters) {
  setters.setImportOpen(false);
  setters.setImportDraft("");
  setters.setImportError(null);
}

function resetCreateFormFields(setters: FormSetters) {
  setters.setName("");
  setters.setTransport("http");
  setters.setUrl("");
  setters.setHeaders([emptyHeaderRow()]);
  setters.setCommand("");
  setters.setArgs([]);
  setters.setEnv([emptyHeaderRow()]);
  setters.setSubmitError(null);
  setters.setTestResult(null);
  setters.setTesting(false);
}

function applyServerConfigToForm(
  setters: FormSetters,
  transport: McpTransport,
  config: McpStdioConfig | McpHttpConfig
) {
  setters.setTransport(transport);

  if (transport === "stdio") {
    const stdioConfig = config as McpStdioConfig;
    setters.setCommand(stdioConfig.command);
    setters.setArgs(stdioConfig.args ?? []);
    setters.setEnv(recordToHeaderRows(stdioConfig.env));
    setters.setUrl("");
    setters.setHeaders([emptyHeaderRow()]);
    return;
  }

  const httpConfig = config as McpHttpConfig;
  setters.setUrl(httpConfig.url);
  setters.setHeaders(recordToHeaderRows(httpConfig.headers));
  setters.setCommand("");
  setters.setArgs([]);
  setters.setEnv([emptyHeaderRow()]);
}

function applyDetailToForm(
  setters: FormSetters,
  detail: {
    name: string;
    transport: McpTransport;
    config: McpStdioConfig | McpHttpConfig;
  }
) {
  setters.setName(detail.name);
  setters.setSubmitError(null);
  setters.setTestResult(null);
  setters.setTesting(false);
  applyServerConfigToForm(setters, detail.transport, detail.config);
}

function applyImportedServer(
  setters: FormSetters,
  imported: ParsedMcpServerImport
) {
  setters.setName(imported.name);
  applyServerConfigToForm(setters, imported.transport, imported.config);
}

function buildMcpServerRequest({
  args,
  command,
  env,
  headers,
  isEdit,
  name,
  server,
  transport,
  url,
}: {
  args: string[];
  command: string;
  env: McpHeaderRow[];
  headers: McpHeaderRow[];
  isEdit: boolean;
  name: string;
  server?: McpServerSummary | null;
  transport: McpTransport;
  url: string;
}): CreateMcpServerRequest {
  const activeTransport = resolveFormTransport(transport, command, url);

  if (activeTransport === "stdio") {
    return {
      config: {
        args: argsToArray(args),
        command: command.trim(),
        env: headersToRecord(env, isEdit),
      },
      connect: false,
      name: name.trim(),
      transport: "stdio",
      ...(isEdit && server ? { serverId: server.id } : {}),
    };
  }

  return {
    config: {
      headers: headersToRecord(headers, isEdit),
      url: url.trim(),
    },
    connect: false,
    name: name.trim(),
    transport: "http",
    ...(isEdit && server ? { serverId: server.id } : {}),
  };
}

function mcpFormResetKey({
  detail,
  open,
  server,
}: {
  detail: { name: string; transport: McpTransport } | null | undefined;
  open: boolean;
  server?: McpServerSummary | null;
}): string {
  if (!open) {
    return "closed";
  }
  if (!server) {
    return "create";
  }
  if (!detail) {
    return `edit-${server.id}-loading`;
  }
  return `edit-${server.id}-${detail.name}-${detail.transport}`;
}

function canSubmitMcpForm({
  command,
  loadingForm,
  name,
  transport,
  url,
}: {
  command: string;
  loadingForm: boolean;
  name: string;
  transport: McpTransport;
  url: string;
}): boolean {
  if (name.trim().length === 0 || loadingForm) {
    return false;
  }

  if (resolveFormTransport(transport, command, url) === "http") {
    return url.trim().length > 0;
  }

  return command.trim().length > 0;
}

function syncMcpFormOnResetKeyChange({
  detail,
  open,
  server,
  setters,
}: {
  detail:
    | {
        name: string;
        transport: McpTransport;
        config: McpStdioConfig | McpHttpConfig;
      }
    | null
    | undefined;
  open: boolean;
  server?: McpServerSummary | null;
  setters: FormSetters;
}) {
  if (!open) {
    resetClosedImportState(setters);
    return;
  }
  if (!server) {
    resetCreateFormFields(setters);
    return;
  }
  if (detail) {
    applyDetailToForm(setters, detail);
  }
}

async function testMcpConnection({
  canSubmit,
  request,
  setSubmitError,
  setTestResult,
  setTesting,
}: {
  canSubmit: boolean;
  request: CreateMcpServerRequest;
  setSubmitError: (value: string | null) => void;
  setTestResult: FormSetters["setTestResult"];
  setTesting: (value: boolean) => void;
}) {
  if (!canSubmit) {
    return;
  }

  setTesting(true);
  setSubmitError(null);
  setTestResult(null);

  try {
    const result = await client.testMcpServer(request);

    if (result.ok) {
      setTestResult({
        message:
          result.toolCount === 0
            ? "Connected, but no tools were returned."
            : `Connected. Found ${result.toolCount} tool${result.toolCount === 1 ? "" : "s"}.`,
        ok: true,
        toolCount: result.toolCount,
        tools: result.tools,
      });
      return;
    }

    setTestResult({
      message: result.error ?? "Connection test failed.",
      ok: false,
      toolCount: 0,
      tools: [],
    });
  } catch (error) {
    setTestResult({
      message: formatError(error),
      ok: false,
      toolCount: 0,
      tools: [],
    });
  } finally {
    setTesting(false);
  }
}

function tryImportMcpJson({
  isEdit,
  setters,
  text,
  transport,
}: {
  isEdit: boolean;
  setters: FormSetters;
  text: string;
  transport: McpTransport;
}): string | null {
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

  applyImportedServer(setters, result.server);
  setters.setSubmitError(null);
  setters.setTestResult(null);
  return null;
}

export function useMcpServerDialogState({
  open,
  busy,
  server,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  server?: McpServerSummary | null;
  onSubmit: (request: CreateMcpServerRequest) => Promise<void>;
}) {
  const isEdit = server != null;
  const { data: detail, isLoading: loadingDetail } = useMcpServerDetailQuery(
    open && server ? server.id : null
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

  const setters: FormSetters = {
    setArgs,
    setCommand,
    setEnv,
    setHeaders,
    setImportDraft,
    setImportError,
    setImportOpen,
    setName,
    setSubmitError,
    setTesting,
    setTestResult,
    setTransport,
    setUrl,
  };

  const idPrefix = server ? `mcp-edit-${server.id}` : "mcp-create";
  const loadingForm = isEdit && loadingDetail && !detail;
  const formDisabled = busy || testing || loadingForm;
  const canSubmit = canSubmitMcpForm({
    command,
    loadingForm,
    name,
    transport,
    url,
  });

  const formResetKey = mcpFormResetKey({ detail, open, server });
  const [prevFormResetKey, setPrevFormResetKey] = useState(formResetKey);

  if (formResetKey !== prevFormResetKey) {
    setPrevFormResetKey(formResetKey);
    syncMcpFormOnResetKeyChange({ detail, open, server, setters });
  }

  function clearTestResult() {
    setTestResult(null);
  }

  function buildRequest(): CreateMcpServerRequest {
    return buildMcpServerRequest({
      args,
      command,
      env,
      headers,
      isEdit,
      name,
      server,
      transport,
      url,
    });
  }

  async function handleTestConnection() {
    await testMcpConnection({
      canSubmit,
      request: buildRequest(),
      setSubmitError,
      setTesting,
      setTestResult,
    });
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
    tryImportMcpJson({ isEdit, setters, text, transport });
  }

  function openImportDialog() {
    setImportDraft("");
    setImportError(null);
    setImportOpen(true);
  }

  function handleImportApply() {
    const error = tryImportMcpJson({
      isEdit,
      setters,
      text: importDraft,
      transport,
    });

    if (error) {
      setImportError(error);
      setTestResult(null);
      return;
    }

    setImportOpen(false);
    setImportDraft("");
    setImportError(null);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!canSubmit || busy) {
      return;
    }

    setSubmitError(null);

    try {
      await onSubmit(buildRequest());
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : formatError(error)
      );
    }
  }

  return {
    args,
    canSubmit,
    clearTestResult,
    command,
    env,
    formDisabled,
    handleImportApply,
    handlePaste,
    handleSubmit,
    handleTestConnection,
    headers,
    idPrefix,
    importDraft,
    importError,
    importOpen,
    isEdit,
    loadingForm,
    name,
    openImportDialog,
    setArgs,
    setCommand,
    setEnv,
    setHeaders,
    setImportDraft,
    setImportError,
    setImportOpen,
    setName,
    setTransport,
    setUrl,
    submitError,
    testing,
    testResult,
    transport,
    url,
  };
}
