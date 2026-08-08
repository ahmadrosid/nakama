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

  if (formResetKey !== prevFormResetKey) {
    setPrevFormResetKey(formResetKey);

    if (!open) {
      setImportOpen(false);
      setImportDraft("");
      setImportError(null);
    } else if (!server) {
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
    } else if (detail) {
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
      } else {
        const httpConfig = detail.config as McpHttpConfig;
        setUrl(httpConfig.url);
        setHeaders(recordToHeaderRows(httpConfig.headers));
        setCommand("");
        setArgs([]);
        setEnv([emptyHeaderRow()]);
      }
    }
  }

  function buildRequest(): CreateMcpServerRequest {
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
