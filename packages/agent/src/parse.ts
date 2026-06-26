import {
  createId,
  type AutomationDefinition,
  type AutomationStep,
  type AutomationTrigger,
  type ToolDefinition,
} from "@tinyclaw/core";

interface GeneratedAutomationPayload {
  name?: unknown;
  description?: unknown;
  trigger?: unknown;
  steps?: unknown;
}

export function parseAutomationResponse(
  raw: string,
  request: { prompt: string; tools: ToolDefinition[] },
): AutomationDefinition {
  const payload = extractJsonObject(raw) as GeneratedAutomationPayload;
  const allowedTools = new Set(request.tools.map((tool) => tool.name));

  const name = sanitizeName(payload.name, request.prompt);
  const description = sanitizeDescription(payload.description, request.prompt);
  const trigger = parseTrigger(payload.trigger);
  const steps = parseSteps(payload.steps, allowedTools);

  return {
    id: createId("automation"),
    name,
    description,
    prompt: request.prompt,
    trigger,
    steps,
    version: 1,
  };
}

function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();

  const candidate = fenced ?? trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");

    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }

    throw new Error("Agent response did not contain valid JSON.");
  }
}

function sanitizeName(value: unknown, prompt: string): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim().slice(0, 60);
  }

  return deriveName(prompt);
}

function sanitizeDescription(value: unknown, prompt: string): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  return prompt.trim();
}

function parseTrigger(value: unknown): AutomationTrigger {
  if (!value || typeof value !== "object") {
    return { type: "manual" };
  }

  const trigger = value as Record<string, unknown>;

  if (trigger.type === "schedule" && typeof trigger.cron === "string") {
    return {
      type: "schedule",
      cron: trigger.cron.trim(),
      timezone:
        typeof trigger.timezone === "string" ? trigger.timezone.trim() : undefined,
    };
  }

  if (trigger.type === "runAt" && typeof trigger.at === "string") {
    return {
      type: "runAt",
      at: trigger.at.trim(),
      timezone:
        typeof trigger.timezone === "string" ? trigger.timezone.trim() : undefined,
    };
  }

  return { type: "manual" };
}

function parseSteps(
  value: unknown,
  allowedTools: Set<string>,
): AutomationStep[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const steps: AutomationStep[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const step = item as Record<string, unknown>;
    const tool = typeof step.tool === "string" ? step.tool.trim() : "";

    if (!tool || !allowedTools.has(tool)) {
      continue;
    }

    steps.push({
      id: createId("step"),
      tool,
      input:
        step.input && typeof step.input === "object" && !Array.isArray(step.input)
          ? (step.input as Record<string, unknown>)
          : {},
    });
  }

  return steps;
}

function deriveName(text: string): string {
  const line = text.split(/\r?\n/)[0]?.trim() ?? "";

  if (!line) {
    return "New automation";
  }

  return line.replace(/[.?!].*$/, "").slice(0, 60) || "New automation";
}
