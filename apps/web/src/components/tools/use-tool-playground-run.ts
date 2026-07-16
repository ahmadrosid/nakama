import type { ToolDetail } from "@nakama/core/contract";
import { useState } from "react";
import { useAppNavigation } from "@/hooks/use-app-navigation";
import { client, formatError } from "@/lib/client";
import { buildSuperBotFixDraft } from "@/lib/tool-playground-draft";
import { buildExampleParametersJson } from "@/lib/tool-playground-params";

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

export function formatToolPlaygroundResult(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
