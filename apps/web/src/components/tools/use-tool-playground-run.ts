import type { JsonValue, ToolDetail } from "@nakama/core/contract";
import { useState } from "react";
import { useAppNavigation } from "@/hooks/use-app-navigation";
import { client, formatError } from "@/lib/client";
import { buildSuperBotFixDraft } from "@/lib/tool-playground-draft";
import { buildExampleParametersJson } from "@/lib/tool-playground-params";

type JsonRecord = Record<string, JsonValue>;

type ToolPlaygroundRunState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "success"; result: unknown; parameters: JsonRecord }
  | { status: "error"; error: string; parameters: JsonRecord };

export interface ToolPlaygroundRunControls {
  actionError: string | null;
  assistPrompt: string;
  handleFixWithSuperBot: () => void;
  handleRun: () => Promise<void>;
  handleSuggestParams: () => Promise<void>;
  jsonError: string | null;
  parametersJson: string;
  running: boolean;
  runState: ToolPlaygroundRunState;
  setAssistPrompt: (value: string) => void;
  setParametersJson: (value: string) => void;
  suggesting: boolean;
}

function parseParametersJson(raw: string): JsonRecord | null {
  try {
    const parsed: unknown = JSON.parse(raw);

    if (isJsonRecord(parsed)) {
      // SAFETY: JSON.parse creates JSON values, and this guard confirms a non-null, non-array object with valid values.
      return parsed as Record<string, JsonValue>;
    }
  } catch {
    return null;
  }

  return null;
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This boundary guard checks parsed JSON before the cast.
function isJsonRecord(value: unknown): boolean {
  return (
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- JSON.parse output needs a record check.
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(isJsonValue)
  );
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- JSON.parse output needs a scalar check.
    typeof value === "string" ||
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- JSON.parse output needs a scalar check.
    typeof value === "number" ||
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- JSON.parse output needs a scalar check.
    typeof value === "boolean"
  ) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }

  return isJsonRecord(value);
}

export function useToolPlaygroundRun(
  tool: ToolDetail,
  superBotProfileId: string | null
): ToolPlaygroundRunControls {
  const { navigateToNewChat } = useAppNavigation();

  const [parametersJson, setParametersJsonState] = useState(() =>
    buildExampleParametersJson(tool.parameters)
  );

  const [jsonError, setJsonError] = useState<string | null>(null);
  const [assistPrompt, setAssistPrompt] = useState("");
  const [suggesting, setSuggesting] = useState(false);

  const [runState, setRunState] = useState<ToolPlaygroundRunState>({
    status: "idle",
  });

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
          error: response.error ?? "Tool run failed.",
          parameters,
          status: "error",
        });

        return;
      }

      setRunState({ parameters, result: response.result, status: "success" });
    } catch (error) {
      setRunState({
        error: formatError(error),
        parameters,
        status: "error",
      });
    }
  }

  function handleFixWithSuperBot() {
    if (runState.status !== "error" || !superBotProfileId) {
      return;
    }

    const draft = buildSuperBotFixDraft({
      error: runState.error,
      parameters: runState.parameters,
      toolName: tool.name,
    });

    navigateToNewChat(superBotProfileId, { draft });
  }

  function setParametersJson(value: string) {
    setParametersJsonState(value);
    setJsonError(null);
  }

  return {
    actionError,
    assistPrompt,
    handleFixWithSuperBot,
    handleRun,
    handleSuggestParams,
    jsonError,
    parametersJson,
    running: runState.status === "running",
    runState,
    setAssistPrompt,
    setParametersJson,
    suggesting,
  };
}

export function formatToolPlaygroundResult<Value>(value: Value): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
