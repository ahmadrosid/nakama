import type { ToolDetail } from "@nakama/core/contract";
import { PlayIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useAppNavigation } from "@/hooks/use-app-navigation";
import { client, formatError } from "@/lib/client";
import { buildSuperBotFixDraft } from "@/lib/tool-playground-draft";
import { buildExampleParametersJson } from "@/lib/tool-playground-params";
import { ToolSourceCodeBlock } from "@/components/tools/ToolSourceCodeBlock";

export type ToolPlaygroundRunState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "success"; result: unknown; parameters: Record<string, unknown> }
  | { status: "error"; error: string; parameters: Record<string, unknown> };

export interface ToolPlaygroundRunControls {
  parametersJson: string;
  setParametersJson: (value: string) => void;
  jsonError: string | null;
  assistPrompt: string;
  setAssistPrompt: (value: string) => void;
  suggesting: boolean;
  runState: ToolPlaygroundRunState;
  actionError: string | null;
  running: boolean;
  handleSuggestParams: () => Promise<void>;
  handleRun: () => Promise<void>;
  handleFixWithSuperBot: () => void;
}

function parseParametersJson(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);

    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }

  return null;
}

function formatResult(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function useToolPlaygroundRun(
  tool: ToolDetail,
  superBotProfileId: string | null,
): ToolPlaygroundRunControls {
  const { navigateToNewChat } = useAppNavigation();
  const [parametersJson, setParametersJsonState] = useState(() =>
    buildExampleParametersJson(tool.parameters),
  );
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [assistPrompt, setAssistPrompt] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [runState, setRunState] = useState<ToolPlaygroundRunState>({ status: "idle" });
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleSuggestParams() {
    const prompt = assistPrompt.trim();

    if (!prompt) {
      setActionError("Describe what you want to test first.");
      return;
    }

    setSuggesting(true);
    setActionError(null);

    try {
      const response = await client.suggestToolParams(tool.id, { prompt });
      setParametersJson(JSON.stringify(response.parameters ?? {}, null, 2));
    } catch (error) {
      setActionError(formatError(error));
    } finally {
      setSuggesting(false);
    }
  }

  async function handleRun() {
    const parameters = parseParametersJson(parametersJson);

    if (!parameters) {
      setJsonError("Enter valid JSON parameters before running.");
      return;
    }

    setJsonError(null);
    setActionError(null);
    setRunState({ status: "running" });

    try {
      const response = await client.runTool(tool.id, { parameters });

      if (!response.ok) {
        setRunState({
          status: "error",
          error: response.error ?? "Tool run failed.",
          parameters,
        });
        return;
      }

      setRunState({ status: "success", result: response.result, parameters });
    } catch (error) {
      setRunState({
        status: "error",
        error: formatError(error),
        parameters,
      });
    }
  }

  function handleFixWithSuperBot() {
    if (runState.status !== "error" || !superBotProfileId) {
      return;
    }

    const draft = buildSuperBotFixDraft({
      toolName: tool.name,
      parameters: runState.parameters,
      error: runState.error,
    });

    navigateToNewChat(superBotProfileId, { draft });
  }

  function setParametersJson(value: string) {
    setParametersJsonState(value);
    setJsonError(null);
  }

  return {
    parametersJson,
    setParametersJson,
    jsonError,
    assistPrompt,
    setAssistPrompt,
    suggesting,
    runState,
    actionError,
    running: runState.status === "running",
    handleSuggestParams,
    handleRun,
    handleFixWithSuperBot,
  };
}

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
          Execute this tool outside chat with real side effects. Relative paths resolve against the
          assigned profile workspace under{" "}
          <code className="type-code">~/.nakama/orgs/…/profiles/…/</code>.
        </p>
      </div>

      <div className="flex flex-col gap-2.5">
        <label className="text-xs font-medium text-foreground" htmlFor={`${tool.id}-assist`}>
          Describe test (optional)
        </label>
        <Input
          id={`${tool.id}-assist`}
          value={run.assistPrompt}
          onChange={(event) => run.setAssistPrompt(event.target.value)}
          placeholder="e.g. convert sample.mp4 to sample.mp3"
          disabled={run.suggesting || run.running}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          disabled={run.suggesting || run.running}
          onClick={() => void run.handleSuggestParams()}
        >
          {run.suggesting ? <Spinner className="size-4" /> : null}
          Suggest params
        </Button>
      </div>

      <div className="flex flex-col gap-2.5">
        <label className="text-xs font-medium text-foreground" htmlFor={`${tool.id}-params`}>
          Parameters (JSON)
        </label>
        <Textarea
          id={`${tool.id}-params`}
          value={run.parametersJson}
          onChange={(event) => {
            run.setParametersJson(event.target.value);
          }}
          rows={10}
          className="font-mono text-xs"
          spellCheck={false}
          disabled={run.running}
        />
        {run.jsonError ? <p className="text-xs text-destructive">{run.jsonError}</p> : null}
      </div>

      <Button
        type="button"
        size="sm"
        className="w-full"
        disabled={run.running}
        onClick={() => void run.handleRun()}
      >
        {run.running ? <Spinner className="size-4" /> : <PlayIcon className="size-4" />}
        Run
      </Button>

      {run.actionError ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
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
        <p className="text-sm text-muted-foreground">
          Run the tool to see raw JSON output or errors here.
        </p>
      ) : null}

      {run.runState.status === "running" ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          Executing tool…
        </div>
      ) : null}

      {run.runState.status === "success" ? (
        <ToolSourceCodeBlock
          content={formatResult(run.runState.result)}
          path="result.json"
        />
      ) : null}

      {run.runState.status === "error" ? (
        <div className="space-y-3">
          <pre className="text-xs leading-relaxed text-destructive">{run.runState.error}</pre>
          {superBotProfileId ? (
            <Button type="button" size="sm" variant="outline" onClick={run.handleFixWithSuperBot}>
              Fix with Super Bot
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
