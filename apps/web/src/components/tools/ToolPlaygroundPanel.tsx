import type { ToolDetail } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import { Input } from "@nakama/ui/input";
import { Spinner } from "@nakama/ui/spinner";
import { Textarea } from "@nakama/ui/textarea";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckmarkCircle02Icon, PlayIcon } from "hugeicons-react";
import { useState } from "react";
import { ToolSourceCodeBlock } from "@/components/tools/ToolSourceCodeBlock";
import {
  formatToolPlaygroundResult,
  type ToolPlaygroundRunControls,
} from "@/components/tools/use-tool-playground-run";
import { client, formatError } from "@/lib/client";

export function ToolPlaygroundRunForm({
  tool,
  run,
}: {
  tool: ToolDetail;
  run: ToolPlaygroundRunControls;
}) {
  return (
    <div className="space-y-4">
      <ToolConfigurationCard toolId={tool.id} />
      <div className="space-y-4 rounded-md border border-border bg-card p-4">
        <div>
          <h3 className="type-section-title">Run</h3>
          <p className="type-body mt-1 text-xs">
            Real side effects. Relative paths resolve in the assigned profile
            workspace under{" "}
            <code className="type-code">~/.nakama/orgs/…/profiles/…/</code>.
          </p>
        </div>

        <div className="flex flex-col gap-2.5">
          <label
            className="font-medium text-foreground text-xs"
            htmlFor={`${tool.id}-assist`}
          >
            Describe test (optional)
          </label>
          <Input
            disabled={run.suggesting || run.running}
            id={`${tool.id}-assist`}
            onChange={(event) => run.setAssistPrompt(event.target.value)}
            placeholder="e.g. convert sample.mp4 to sample.mp3"
            value={run.assistPrompt}
          />
          <Button
            className="w-full"
            disabled={run.suggesting || run.running}
            onClick={() => void run.handleSuggestParams()}
            size="sm"
            type="button"
            variant="outline"
          >
            {run.suggesting ? <Spinner className="size-4" /> : null}
            Suggest params
          </Button>
        </div>

        <div className="flex flex-col gap-2.5">
          <label
            className="font-medium text-foreground text-xs"
            htmlFor={`${tool.id}-params`}
          >
            Parameters (JSON)
          </label>
          <Textarea
            className="font-mono text-xs"
            disabled={run.running}
            id={`${tool.id}-params`}
            onChange={(event) => {
              run.setParametersJson(event.target.value);
            }}
            rows={10}
            spellCheck={false}
            value={run.parametersJson}
          />
          {run.jsonError ? (
            <p className="text-destructive text-xs">{run.jsonError}</p>
          ) : null}
        </div>

        <Button
          className="w-full"
          disabled={run.running}
          onClick={() => void run.handleRun()}
          size="sm"
          type="button"
        >
          {run.running ? (
            <Spinner className="size-4" />
          ) : (
            <PlayIcon className="size-4" />
          )}
          Run
        </Button>

        {run.actionError ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-xs">
            {run.actionError}
          </p>
        ) : null}
      </div>
    </div>
  );
}

interface ConfigField {
  configured: boolean;
  label: string;
  name: string;
  secret: boolean;
  value?: string;
}

function ToolConfigurationCard({ toolId }: { toolId: string }) {
  const queryClient = useQueryClient();
  const queryKey = ["tool-credentials", toolId];

  const status = useQuery({
    queryFn: () => client.getToolCredentialStatus(toolId),
    queryKey,
  });

  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const envFields = status.data?.env;

  // Tools that declare handlerConfig.env get one field per variable; older
  // tools keep the single API key field.
  const fields: ConfigField[] = envFields
    ? envFields.map((entry) => ({ ...entry, label: entry.name }))
    : [
        {
          configured: status.data?.configured === true,
          label: "API key",
          name: "apiKey",
          secret: true,
        },
      ];

  const anyConfigured = fields.some((field) => field.configured);

  return (
    <form
      className="space-y-3 rounded-md border border-border bg-card p-4"
      onSubmit={async (event) => {
        event.preventDefault();

        if (saving) {
          return;
        }

        const form = event.currentTarget;
        const data = new FormData(form);
        const values: Record<string, string> = {};

        for (const field of fields) {
          const value = String(data.get(`tool-config-${field.name}`) ?? "");

          // A blank secret keeps the saved value; an unchanged plain value
          // is not sent again.
          if (value.trim() && value !== field.value) {
            values[field.name] = value;
          }
        }

        if (Object.keys(values).length === 0) {
          return;
        }

        setSaving(true);
        setJustSaved(false);
        setError(null);

        try {
          queryClient.setQueryData(
            queryKey,
            envFields
              ? await client.saveToolEnv(toolId, values)
              : await client.saveToolCredential(toolId, values.apiKey ?? "")
          );

          for (const field of fields) {
            if (field.secret) {
              const input = form.elements.namedItem(
                `tool-config-${field.name}`
              );

              if (input instanceof HTMLInputElement) {
                input.value = "";
              }
            }
          }

          setJustSaved(true);
        } catch (saveError) {
          setError(formatError(saveError));
        } finally {
          setSaving(false);
        }
      }}
    >
      <h3 className="type-section-title">Configuration</h3>
      {fields.map((field) => {
        const inputId = `${toolId}-config-${field.name}`;

        return (
          <div className="space-y-1.5" key={field.name}>
            <div className="flex items-center justify-between gap-2">
              <label
                className={
                  envFields
                    ? "font-medium font-mono text-foreground text-xs"
                    : "font-medium text-foreground text-xs"
                }
                htmlFor={inputId}
              >
                {field.label}
              </label>
              {status.data ? (
                <span
                  className={
                    field.configured
                      ? "flex items-center gap-1 text-emerald-700 text-xs dark:text-emerald-400"
                      : "text-muted-foreground text-xs"
                  }
                >
                  {field.configured ? (
                    <CheckmarkCircle02Icon aria-hidden className="size-3.5" />
                  ) : null}
                  {field.configured ? "Saved" : "Not set"}
                </span>
              ) : null}
            </div>
            {/* new-password + a non-login name keep browsers and password
                managers from filling in the user's own sign-in password. */}
            <Input
              autoComplete={field.secret ? "new-password" : "off"}
              data-1p-ignore
              data-lpignore="true"
              defaultValue={field.value}
              disabled={saving}
              id={inputId}
              key={field.value}
              maxLength={8192}
              name={`tool-config-${field.name}`}
              onChange={() => setJustSaved(false)}
              required={!field.configured}
              type={field.secret ? "password" : "text"}
            />
          </div>
        );
      })}
      <div className="flex items-center gap-3">
        <Button disabled={saving} type="submit" variant="outline">
          {saving ? <Spinner className="size-4" /> : null}
          {anyConfigured ? "Update" : "Save"}
        </Button>
        {justSaved ? (
          <span className="text-muted-foreground text-xs" role="status">
            Saved just now
          </span>
        ) : null}
      </div>
      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

export function ToolPlaygroundOutput({
  run,
  superBotProfileId,
}: {
  run: ToolPlaygroundRunControls;
  superBotProfileId: string | null;
}) {
  return (
    <div className="min-h-32">
      {run.runState.status === "idle" ? (
        <p className="text-muted-foreground text-sm">
          Run the tool to see raw JSON output or errors here.
        </p>
      ) : null}

      {run.runState.status === "running" ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Spinner className="size-4" />
          Executing tool…
        </div>
      ) : null}

      {run.runState.status === "success" ? (
        <ToolSourceCodeBlock
          content={formatToolPlaygroundResult(run.runState.result)}
          path="result.json"
        />
      ) : null}

      {run.runState.status === "error" ? (
        <div className="space-y-3">
          <pre className="text-destructive text-xs leading-relaxed">
            {run.runState.error}
          </pre>
          {superBotProfileId ? (
            <Button
              onClick={run.handleFixWithSuperBot}
              size="sm"
              type="button"
              variant="outline"
            >
              Fix with Super Bot
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
