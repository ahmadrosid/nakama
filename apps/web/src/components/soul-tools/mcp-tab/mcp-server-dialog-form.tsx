import type { CachedMcpToolSummary, McpTransport } from "@nakama/core/contract";
import { BracesIcon } from "lucide-react";
import {
  McpArgsEditor,
  McpFormField,
  McpHeadersEditor,
} from "@/components/soul-tools/mcp-tab/McpFormEditors";
import type { McpHeaderRow } from "@/components/soul-tools/mcp-tab/shared";
import { McpToolList } from "@/components/soul-tools/McpToolList";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export function McpServerDialogForm({
  idPrefix,
  isEdit,
  transport,
  name,
  url,
  headers,
  command,
  args,
  env,
  formDisabled,
  loadingForm,
  canSubmit,
  testing,
  testResult,
  submitError,
  onTransportChange,
  onOpenImport,
  onNameChange,
  onUrlChange,
  onHeadersChange,
  onCommandChange,
  onArgsChange,
  onEnvChange,
  onTestConnection,
}: {
  idPrefix: string;
  isEdit: boolean;
  transport: McpTransport;
  name: string;
  url: string;
  headers: McpHeaderRow[];
  command: string;
  args: string[];
  env: McpHeaderRow[];
  formDisabled: boolean;
  loadingForm: boolean;
  canSubmit: boolean;
  testing: boolean;
  testResult: {
    ok: boolean;
    toolCount: number;
    message: string;
    tools: CachedMcpToolSummary[];
  } | null;
  submitError: string | null;
  onTransportChange: (transport: McpTransport) => void;
  onOpenImport: () => void;
  onNameChange: (value: string) => void;
  onUrlChange: (value: string) => void;
  onHeadersChange: (rows: McpHeaderRow[]) => void;
  onCommandChange: (value: string) => void;
  onArgsChange: (args: string[]) => void;
  onEnvChange: (rows: McpHeaderRow[]) => void;
  onTestConnection: () => void;
}) {
  if (loadingForm) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Spinner className="size-4" />
        Loading server…
      </div>
    );
  }

  return (
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
            onClick={onOpenImport}
          >
            <BracesIcon aria-hidden />
            Import JSON
          </Button>
        }
      >
        <div role="tablist" aria-label="MCP transport" className="segmented-control w-full">
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
              onClick={() => onTransportChange(item.id)}
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
          onChange={(event) => onNameChange(event.target.value)}
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
                onChange={(event) => onUrlChange(event.target.value)}
                placeholder="https://example.com/mcp"
              />
            </McpFormField>

            <McpFormField label="Headers" hint="Optional">
              <McpHeadersEditor
                headers={headers}
                isEdit={isEdit}
                disabled={formDisabled}
                onChange={onHeadersChange}
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
                  onChange={(event) => onCommandChange(event.target.value)}
                  placeholder="npx"
                />
              </McpFormField>

              <McpFormField label="Arguments" hint="Optional">
                <McpArgsEditor
                  args={args}
                  disabled={formDisabled}
                  inputId={`${idPrefix}-args`}
                  onChange={onArgsChange}
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
                onChange={onEnvChange}
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
        onClick={onTestConnection}
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
        <p className="rounded-md bg-destructive/10 px-3 py-2.5 text-sm text-destructive" role="alert">
          {submitError}
        </p>
      ) : null}
    </div>
  );
}
