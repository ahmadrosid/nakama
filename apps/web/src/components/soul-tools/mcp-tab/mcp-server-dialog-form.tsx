import type { CachedMcpToolSummary } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import { Input } from "@nakama/ui/input";
import { Spinner } from "@nakama/ui/spinner";
import { cn } from "@nakama/ui/utils";
import { CodeIcon } from "hugeicons-react";
import { McpToolList } from "@/components/soul-tools/McpToolList";
import {
  McpArgsEditor,
  McpFormField,
  McpHeadersEditor,
} from "@/components/soul-tools/mcp-tab/McpFormEditors";
import type { McpHeaderRow } from "@/components/soul-tools/mcp-tab/shared";
import type { McpServerKind } from "@/components/soul-tools/mcp-tab/use-mcp-server-dialog-state";

const TEST_RESULT_TONE = {
  bad: "bg-destructive/10 text-destructive",
  ok: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  pending: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
} as const;

/**
 * A server asking for a browser sign-in is not misconfigured, so it never gets
 * the red box that means "fix your input", and in the Sign-in tab it is the
 * answer the operator was after.
 */
function testResultTone(
  result: { ok: boolean; requiresAuthorization: boolean },
  signIn: boolean
): keyof typeof TEST_RESULT_TONE {
  if (result.ok || (signIn && result.requiresAuthorization)) {
    return "ok";
  }

  return result.requiresAuthorization ? "pending" : "bad";
}

function kindHint(kind: McpServerKind): string {
  if (kind === "signin") {
    return "A hosted server that signs you in through your browser (OAuth). Nakama registers itself with the provider and stores the grant, so there is no key to paste.";
  }

  if (kind === "stdio") {
    return "A command Nakama runs locally, one process per profile.";
  }

  return "A remote endpoint that takes an API key or another header, if it needs one at all.";
}

export function McpServerDialogForm({
  idPrefix,
  isEdit,
  nameAutoFocus = true,
  kind,
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
  onKindChange,
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
  nameAutoFocus?: boolean;
  kind: McpServerKind;
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
    requiresAuthorization: boolean;
    tools: CachedMcpToolSummary[];
  } | null;
  submitError: string | null;
  onKindChange: (kind: McpServerKind) => void;
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
        label="Server type"
      >
        <div
          aria-label="MCP server type"
          className="segmented-control w-full"
          role="tablist"
        >
          {(
            [
              { id: "http" as const, label: "HTTP" },
              { id: "signin" as const, label: "Sign-in" },
              { id: "stdio" as const, label: "Command" },
            ] as const
          ).map((item) => (
            <button
              aria-controls={`${idPrefix}-transport-panel-${item.id}`}
              aria-selected={kind === item.id}
              className="segmented-control-item"
              data-active={kind === item.id || undefined}
              disabled={formDisabled || isEdit}
              id={`${idPrefix}-transport-${item.id}`}
              key={item.id}
              onClick={() => onKindChange(item.id)}
              role="tab"
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-muted-foreground text-xs">{kindHint(kind)}</p>
      </McpFormField>

      <McpFormField htmlFor={`${idPrefix}-name`} label="Name">
        <Input
          autoFocus={nameAutoFocus}
          disabled={formDisabled}
          id={`${idPrefix}-name`}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder="server name"
          value={name}
        />
      </McpFormField>

      <div
        aria-labelledby={`${idPrefix}-transport-${kind}`}
        className="space-y-5"
        id={`${idPrefix}-transport-panel-${kind}`}
        role="tabpanel"
      >
        {kind === "http" || kind === "signin" ? (
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

            {kind === "http" ? (
              <McpFormField hint="Optional" label="Headers">
                <McpHeadersEditor
                  disabled={formDisabled}
                  headers={headers}
                  isEdit={isEdit}
                  onChange={onHeadersChange}
                />
              </McpFormField>
            ) : null}
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
              TEST_RESULT_TONE[testResultTone(testResult, kind === "signin")]
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
