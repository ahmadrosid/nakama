/**
 * Turn Cursor Agent CLI stream-json (NDJSON) stdout into a short, readable
 * summary for the parent Nakama agent. Bash truncates at 32k from the head by
 * default — stream-json puts the useful result at the end — so coding-agent
 * runs should summarize instead of returning the raw firehose.
 */

const MAX_SUMMARY_CHARS = 24_000;
const MAX_ASSISTANT_CHARS = 12_000;
const MAX_TOOL_LINES = 40;
const MIN_CURSOR_AGENT_JSON_LINE_RATIO = 0.8;
const CURSOR_AGENT_ACTIVITY_TYPES = new Set([
  "assistant",
  "tool_call",
  "result",
]);

export function looksLikeCursorAgentStreamJson(stdout: string): boolean {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return false;
  }

  let parsedLineCount = 0;
  let firstParsedObject: Record<string, unknown> | null = null;
  let hasActivityEvent = false;
  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    parsedLineCount += 1;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      continue;
    }

    const event = parsed as Record<string, unknown>;
    if (!firstParsedObject) {
      firstParsedObject = event;
      continue;
    }

    const type = event.type;
    if (typeof type === "string" && CURSOR_AGENT_ACTIVITY_TYPES.has(type)) {
      hasActivityEvent = true;
    }
  }

  const hasInitEvent =
    firstParsedObject?.type === "system" &&
    firstParsedObject.subtype === "init" &&
    typeof firstParsedObject.model === "string" &&
    typeof firstParsedObject.cwd === "string";
  return (
    hasInitEvent &&
    hasActivityEvent &&
    parsedLineCount / lines.length >= MIN_CURSOR_AGENT_JSON_LINE_RATIO
  );
}

export function formatCodingAgentBashStdout(
  stdout: string,
  options: { logPath?: string | null; exitCode?: number | null } = {}
): string {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return appendLogFooter("", options.logPath);
  }

  if (looksLikeCursorAgentStreamJson(trimmed)) {
    return appendLogFooter(
      summarizeCursorAgentStreamJson(trimmed, options.exitCode),
      options.logPath
    );
  }

  return appendLogFooter(
    capText(trimmed, MAX_SUMMARY_CHARS, "tail"),
    options.logPath
  );
}

export function summarizeCursorAgentStreamJson(
  stdout: string,
  exitCode?: number | null
): string {
  const assistantChunks: string[] = [];
  const toolLines: string[] = [];
  let resultLine: string | null = null;
  let initLine: string | null = null;
  let parseErrors = 0;
  let eventCount = 0;

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      parseErrors += 1;
      continue;
    }

    eventCount += 1;
    const type = typeof event.type === "string" ? event.type : "";

    if (type === "system" && event.subtype === "init") {
      const model = typeof event.model === "string" ? event.model : null;
      const cwd = typeof event.cwd === "string" ? event.cwd : null;
      const bits = [
        model ? `model=${model}` : null,
        cwd ? `cwd=${cwd}` : null,
        typeof event.apiKeySource === "string"
          ? `auth=${event.apiKeySource}`
          : null,
      ].filter(Boolean);
      initLine = bits.length > 0 ? bits.join(", ") : "Cursor Agent started";
      continue;
    }

    if (type === "assistant") {
      const text = extractAssistantText(event);
      if (text) {
        assistantChunks.push(text);
      }
      continue;
    }

    if (type === "tool_call") {
      const lineText = formatToolCallLine(event);
      if (lineText) {
        toolLines.push(lineText);
      }
      continue;
    }

    if (type === "result") {
      resultLine = formatResultLine(event);
    }
  }

  const sections: string[] = ["# Cursor Agent result"];

  if (initLine) {
    sections.push("", initLine);
  }

  if (exitCode != null) {
    sections.push("", `exitCode=${exitCode}`);
  }

  const assistantText = joinAssistantChunks(assistantChunks);
  if (assistantText) {
    sections.push("", "## Assistant", assistantText);
  }

  if (toolLines.length > 0) {
    const omitted = Math.max(0, toolLines.length - MAX_TOOL_LINES);
    const shown = omitted > 0 ? toolLines.slice(-MAX_TOOL_LINES) : toolLines;
    sections.push("", "## Tools");
    if (omitted > 0) {
      sections.push(`- …${omitted} earlier tool calls omitted`);
    }
    sections.push(...shown.map((line) => `- ${line}`));
  }

  if (resultLine) {
    sections.push("", "## Result", resultLine);
  } else if (eventCount > 0 && !assistantText) {
    sections.push(
      "",
      "## Result",
      "No final result event in captured stream. Check git status in the repo cwd or the full log."
    );
  }

  if (parseErrors > 0) {
    sections.push("", `(ignored ${parseErrors} non-JSON stream lines)`);
  }

  if (eventCount === 0) {
    return capText(stdout, MAX_SUMMARY_CHARS, "tail");
  }

  return capText(sections.join("\n"), MAX_SUMMARY_CHARS, "tail");
}

function extractAssistantText(event: Record<string, unknown>): string | null {
  const message = event.message;
  if (!message || typeof message !== "object") {
    return null;
  }

  const content = (message as { content?: unknown }).content;
  if (typeof content === "string" && content.trim()) {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return null;
  }

  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") {
      continue;
    }
    const text = (part as { text?: unknown }).text;
    if (typeof text === "string" && text.trim()) {
      parts.push(text.trim());
    }
  }

  return parts.length > 0 ? parts.join("\n") : null;
}

function joinAssistantChunks(chunks: string[]): string {
  if (chunks.length === 0) {
    return "";
  }

  // Prefer later turns — early ones are often "I'll read X next".
  const merged = chunks.join("\n\n").trim();
  return capText(merged, MAX_ASSISTANT_CHARS, "tail");
}

function formatToolCallLine(event: Record<string, unknown>): string | null {
  const subtype = typeof event.subtype === "string" ? event.subtype : "";
  const toolCall = event.tool_call;
  if (!toolCall || typeof toolCall !== "object") {
    return subtype ? `tool_call ${subtype}` : null;
  }

  const call = toolCall as Record<string, unknown>;
  for (const [key, value] of Object.entries(call)) {
    if (!(key.endsWith("ToolCall") && value) || typeof value !== "object") {
      continue;
    }
    const name = key.replace(/ToolCall$/, "");
    const args = (value as { args?: Record<string, unknown> }).args;
    const detail = summarizeToolArgs(name, args);
    return `${subtype || "tool"} ${name}${detail ? `: ${detail}` : ""}`;
  }

  return `tool_call ${subtype || "unknown"}`.trim();
}

function summarizeToolArgs(
  name: string,
  args: Record<string, unknown> | undefined
): string {
  if (!args) {
    return "";
  }

  const path =
    (typeof args.path === "string" && args.path) ||
    (typeof args.file_path === "string" && args.file_path) ||
    (typeof args.target_notebook === "string" && args.target_notebook) ||
    null;
  if (path) {
    return path;
  }

  if (typeof args.command === "string") {
    return capText(args.command, 120, "head");
  }

  if (typeof args.pattern === "string") {
    return capText(args.pattern, 80, "head");
  }

  if (
    name.toLowerCase().includes("write") ||
    name.toLowerCase().includes("edit")
  ) {
    return "(edit)";
  }

  return "";
}

function formatResultLine(event: Record<string, unknown>): string {
  const subtype = typeof event.subtype === "string" ? event.subtype : null;
  const bits: string[] = [];
  if (subtype) {
    bits.push(subtype);
  }
  if (typeof event.result === "string" && event.result.trim()) {
    bits.push(capText(event.result.trim(), 4000, "tail"));
  } else if (typeof event.message === "string" && event.message.trim()) {
    bits.push(capText(event.message.trim(), 4000, "tail"));
  }
  if (typeof event.duration_ms === "number") {
    bits.push(`durationMs=${event.duration_ms}`);
  }
  return bits.length > 0 ? bits.join("\n") : "result event received";
}

function appendLogFooter(body: string, logPath?: string | null): string {
  if (!logPath) {
    return body;
  }

  const footer = `\n\nFull coding-agent log: ${logPath}`;
  if (!body) {
    return footer.trim();
  }

  return `${body}${footer}`;
}

function capText(
  value: string,
  maxChars: number,
  mode: "head" | "tail"
): string {
  if (value.length <= maxChars) {
    return value;
  }

  if (mode === "tail") {
    return `...[truncated]\n${value.slice(value.length - maxChars)}`;
  }

  return `${value.slice(0, maxChars)}\n...[truncated]`;
}

export function commandLooksLikeCursorAgent(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) {
    return false;
  }

  // First argv token; allow absolute/relative paths ending in `agent`.
  const first = trimmed.split(/\s+/, 1)[0] ?? "";
  const base = first.split(/[/\\]/).pop() ?? first;
  return base === "agent";
}
