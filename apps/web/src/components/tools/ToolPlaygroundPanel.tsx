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
    <>
      <ToolApiKeyForm toolId={tool.id} />
      <div className="space-y-4 p-4 sm:p-5">
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
    </>
  );
}

function ToolApiKeyForm({ toolId }: { toolId: string }) {
  const queryClient = useQueryClient();
  const queryKey = ["tool-credentials", toolId];
  const status = useQuery({
    queryFn: () => client.getToolCredentialStatus(toolId),
    queryKey,
  });
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = `${toolId}-api-key`;
  const configured = status.data?.configured === true;

  return (
    <form
      className="space-y-2.5 border-border border-b p-4 sm:p-5"
      onSubmit={async (event) => {
        event.preventDefault();
        if (saving) {
          return;
        }
        const form = event.currentTarget;
        const apiKey = String(new FormData(form).get("toolApiKey") ?? "");
        setSaving(true);
        setJustSaved(false);
        setError(null);
        try {
          queryClient.setQueryData(
            queryKey,
            await client.saveToolCredential(toolId, apiKey)
          );
          form.reset();
          setJustSaved(true);
        } catch (saveError) {
          setError(formatError(saveError));
        } finally {
          setSaving(false);
        }
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <label className="type-section-title" htmlFor={inputId}>
          API key
        </label>
        {status.data ? (
          <span
            className={
              configured
                ? "flex items-center gap-1 text-emerald-700 text-xs dark:text-emerald-400"
                : "text-muted-foreground text-xs"
            }
            role="status"
          >
            {configured ? (
              <CheckmarkCircle02Icon aria-hidden className="size-3.5" />
            ) : null}
            {justSaved ? "Saved just now" : configured ? "Saved" : "Not set"}
          </span>
        ) : null}
      </div>
      <div className="flex gap-2">
        {/* new-password + a non-login name keep browsers and password
            managers from filling in the user's own sign-in password. */}
        <Input
          autoComplete="new-password"
          data-1p-ignore
          data-lpignore="true"
          disabled={saving}
          id={inputId}
          maxLength={8192}
          name="toolApiKey"
          onChange={() => setJustSaved(false)}
          required
          type="password"
        />
        <Button disabled={saving} type="submit" variant="outline">
          {saving ? <Spinner className="size-4" /> : null}
          {configured ? "Replace" : "Save"}
        </Button>
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
