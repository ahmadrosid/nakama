import type { CachedMcpToolSummary, McpTransport } from "@nakama/core/contract";
import { CodeIcon } from "hugeicons-react";
import { McpToolList } from "@/components/soul-tools/McpToolList";
import {
  McpArgsEditor,
  McpFormField,
  McpHeadersEditor,
} from "@/components/soul-tools/mcp-tab/McpFormEditors";
import type { McpHeaderRow } from "@/components/soul-tools/mcp-tab/shared";
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
      <div className="flex items-center gap-2 py-8 text-muted-foreground text-sm">
        <Spinner className="size-4" />
        Loading server…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <McpFormField
        action={
          <Button
            className="text-muted-foreground hover:text-foreground"
            disabled={formDisabled}
            onClick={onOpenImport}
            size="xs"
            type="button"
            variant="ghost"
          >
            <CodeIcon aria-hidden />
            Import JSON
          </Button>
        }
        label="Transport"
      >
        <div
          aria-label="MCP transport"
          className="segmented-control w-full"
          role="tablist"
        >
          {(
            [
              { id: "http" as const, label: "HTTP" },
              { id: "stdio" as const, label: "Command" },
            ] as const
          ).map((item) => (
            <button
              aria-controls={`${idPrefix}-transport-panel-${item.id}`}
              aria-selected={transport === item.id}
              className="segmented-control-item"
              data-active={transport === item.id || undefined}
              disabled={formDisabled || isEdit}
              id={`${idPrefix}-transport-${item.id}`}
              key={item.id}
              onClick={() => onTransportChange(item.id)}
              role="tab"
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      </McpFormField>

      <McpFormField htmlFor={`${idPrefix}-name`} label="Name">
        <Input
          autoFocus
          disabled={formDisabled}
          id={`${idPrefix}-name`}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder="server name"
          value={name}
        />
      </McpFormField>

      <div
        aria-labelledby={`${idPrefix}-transport-${transport}`}
        className="space-y-5"
        id={`${idPrefix}-transport-panel-${transport}`}
        role="tabpanel"
      >
        {transport === "http" ? (
          <>
            <McpFormField htmlFor={`${idPrefix}-url`} label="URL">
              <Input
                className="font-mono text-sm"
                disabled={formDisabled}
                id={`${idPrefix}-url`}
                onChange={(event) => onUrlChange(event.target.value)}
                placeholder="https://example.com/mcp"
                value={url}
              />
            </McpFormField>

            <McpFormField hint="Optional" label="Headers">
              <McpHeadersEditor
                disabled={formDisabled}
                headers={headers}
                isEdit={isEdit}
                onChange={onHeadersChange}
              />
            </McpFormField>
          </>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <McpFormField htmlFor={`${idPrefix}-command`} label="Command">
                <Input
                  className="font-mono text-sm"
                  disabled={formDisabled}
                  id={`${idPrefix}-command`}
                  onChange={(event) => onCommandChange(event.target.value)}
                  placeholder="npx"
                  value={command}
                />
              </McpFormField>

              <McpFormField hint="Optional" label="Arguments">
                <McpArgsEditor
                  args={args}
                  disabled={formDisabled}
                  inputId={`${idPrefix}-args`}
                  onChange={onArgsChange}
                />
              </McpFormField>
            </div>

            <McpFormField hint="Optional" label="Environment">
              <McpHeadersEditor
                disabled={formDisabled}
                headers={env}
                isEdit={isEdit}
                keyLabel="Variable"
                onChange={onEnvChange}
                valueLabel="Value"
                valuePlaceholder={
                  isEdit ? "Leave blank to keep" : "secret-value"
                }
              />
            </McpFormField>
          </>
        )}
      </div>

      <Button
        className="self-start"
        disabled={formDisabled || !canSubmit}
        onClick={onTestConnection}
        size="sm"
        type="button"
        variant="outline"
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
                : "bg-destructive/10 text-destructive"
            )}
            role="status"
          >
            {testResult.message}
          </p>

          {testResult.ok && testResult.tools.length > 0 ? (
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <p className="mb-3 font-medium text-foreground text-xs">
                Discovered tools ({testResult.tools.length})
              </p>
              <McpToolList tools={testResult.tools} />
            </div>
          ) : null}
        </div>
      ) : null}

      {submitError ? (
        <p
          className="rounded-md bg-destructive/10 px-3 py-2.5 text-destructive text-sm"
          role="alert"
        >
          {submitError}
        </p>
      ) : null}
    </div>
  );
}
