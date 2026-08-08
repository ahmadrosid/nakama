import type { ToolDetail } from "@nakama/core/contract";
import { PlayIcon } from "lucide-react";
import { ToolSourceCodeBlock } from "@/components/tools/ToolSourceCodeBlock";
import {
  formatToolPlaygroundResult,
  type ToolPlaygroundRunControls,
} from "@/components/tools/use-tool-playground-run";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

export function ToolPlaygroundRunForm({
  tool,
  run,
}: {
  tool: ToolDetail;
  run: ToolPlaygroundRunControls;
}) {
  return (
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
