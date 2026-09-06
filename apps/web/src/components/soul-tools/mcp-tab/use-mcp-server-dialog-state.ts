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

type McpTestResult = {
  ok: boolean;
  toolCount: number;
  message: string;
  tools: CachedMcpToolSummary[];
};

type McpFormSetters = {
  setName: (value: string) => void;
  setTransport: (value: McpTransport) => void;
  setUrl: (value: string) => void;
  setHeaders: (value: McpHeaderRow[]) => void;
  setCommand: (value: string) => void;
  setArgs: (value: string[]) => void;
  setEnv: (value: McpHeaderRow[]) => void;
  setSubmitError: (value: string | null) => void;
  setTestResult: (value: McpTestResult | null) => void;
  setTesting: (value: boolean) => void;
  setImportOpen: (value: boolean) => void;
  setImportDraft: (value: string) => void;
  setImportError: (value: string | null) => void;
};

function applyImportedServer(
  imported: ParsedMcpServerImport,
  setters: Pick<
    McpFormSetters,
    | "setName"
    | "setTransport"
    | "setCommand"
    | "setArgs"
    | "setEnv"
    | "setUrl"
    | "setHeaders"
  >
) {
  setters.setName(imported.name);
  setters.setTransport(imported.transport);

  if (imported.transport === "stdio") {
    const stdioConfig = imported.config as McpStdioConfig;
    setters.setCommand(stdioConfig.command);
    setters.setArgs(stdioConfig.args ?? []);
    setters.setEnv(recordToHeaderRows(stdioConfig.env));
    setters.setUrl("");
    setters.setHeaders([emptyHeaderRow()]);
    return;
  }

  const httpConfig = imported.config as McpHttpConfig;
  setters.setUrl(httpConfig.url);
  setters.setHeaders(recordToHeaderRows(httpConfig.headers));
  setters.setCommand("");
  setters.setArgs([]);
  setters.setEnv([emptyHeaderRow()]);
}

function applyMcpFormReset({
  open,
  server,
  detail,
  setters,
}: {
  open: boolean;
  server?: McpServerSummary | null;
  detail: ReturnType<typeof useMcpServerDetailQuery>["data"];
  setters: McpFormSetters;
}) {
  if (!open) {
    setters.setImportOpen(false);
    setters.setImportDraft("");
    setters.setImportError(null);
    return;
  }

  if (!server) {
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
    return;
  }

  if (!detail) {
    return;
  }

  setters.setName(detail.name);
  setters.setTransport(detail.transport);
  setters.setSubmitError(null);
  setters.setTestResult(null);
  setters.setTesting(false);

  if (detail.transport === "stdio") {
    const stdioConfig = detail.config as McpStdioConfig;
    setters.setCommand(stdioConfig.command);
    setters.setArgs(stdioConfig.args ?? []);
    setters.setEnv(recordToHeaderRows(stdioConfig.env));
    setters.setUrl("");
    setters.setHeaders([emptyHeaderRow()]);
    return;
  }

  const httpConfig = detail.config as McpHttpConfig;
  setters.setUrl(httpConfig.url);
  setters.setHeaders(recordToHeaderRows(httpConfig.headers));
  setters.setCommand("");
  setters.setArgs([]);
  setters.setEnv([emptyHeaderRow()]);
}

function buildMcpServerRequest({
  transport,
  command,
  url,
  args,
  env,
  headers,
  name,
  isEdit,
  server,
}: {
  transport: McpTransport;
  command: string;
  url: string;
  args: string[];
  env: McpHeaderRow[];
  headers: McpHeaderRow[];
  name: string;
  isEdit: boolean;
  server?: McpServerSummary | null;
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

function mcpConnectionTestResult(result: {
  ok: boolean;
  toolCount: number;
  error?: string;
  tools: CachedMcpToolSummary[];
}): McpTestResult {
  if (result.ok) {
    return {
      message:
        result.toolCount === 0
          ? "Connected, but no tools were returned."
          : `Connected. Found ${result.toolCount} tool${result.toolCount === 1 ? "" : "s"}.`,
      ok: true,
      toolCount: result.toolCount,
      tools: result.tools,
    };
  }

  return {
    message: result.error ?? "Connection test failed.",
    ok: false,
    toolCount: 0,
    tools: [],
  };
}

function tryImportMcpJson(
  text: string,
  isEdit: boolean,
  transport: McpTransport,
  setters: Pick<
    McpFormSetters,
    | "setName"
    | "setTransport"
    | "setCommand"
    | "setArgs"
    | "setEnv"
    | "setUrl"
    | "setHeaders"
    | "setSubmitError"
    | "setTestResult"
  >
): string | null {
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

  applyImportedServer(result.server, setters);
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

  const idPrefix = server ? `mcp-edit-${server.id}` : "mcp-create";
  const loadingForm = isEdit && loadingDetail && !detail;
  const formDisabled = busy || testing || loadingForm;
  const canSubmit =
    name.trim().length > 0 &&
    !loadingForm &&
    (resolveFormTransport(transport, command, url) === "http"
      ? url.trim().length > 0
      : command.trim().length > 0);

  const formResetKey = open
    ? server
      ? detail
        ? `edit-${server.id}-${detail.name}-${detail.transport}`
        : `edit-${server.id}-loading`
      : "create"
    : "closed";
  const [prevFormResetKey, setPrevFormResetKey] = useState(formResetKey);

  const formSetters: McpFormSetters = {
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

  if (formResetKey !== prevFormResetKey) {
    setPrevFormResetKey(formResetKey);
    applyMcpFormReset({ detail, open, server, setters: formSetters });
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

  function clearTestResult() {
    setTestResult(null);
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
      setTestResult(mcpConnectionTestResult(result));
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
    tryImportMcpJson(text, isEdit, transport, formSetters);
  }

  function openImportDialog() {
    setImportDraft("");
    setImportError(null);
    setImportOpen(true);
  }

  function handleImportApply() {
    const error = tryImportMcpJson(importDraft, isEdit, transport, formSetters);

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
