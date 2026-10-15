import {
  type AutomationDefinition,
  type AutomationDelivery,
  type AutomationStep,
  type AutomationTrigger,
  createId,
  normalizeAutomationDelivery,
  type ToolDefinition,
} from "@nakama/core";
import { z } from "zod";

const GeneratedTriggerSchema = z.discriminatedUnion("type", [
  z.object({
    cron: z.string(),
    timezone: z.string().optional().catch(undefined),
    type: z.literal("schedule"),
  }),
  z.object({
    at: z.string(),
    timezone: z.string().optional().catch(undefined),
    type: z.literal("runAt"),
  }),
]);

const GeneratedStepSchema = z.object({
  input: z.record(z.string(), z.json()).optional().catch(undefined),
  tool: z.string().optional().catch(undefined),
});

const GeneratedAutomationPayloadSchema = z.object({
  delivery: z.json().optional(),
  description: z.string().optional().catch(undefined),
  name: z.string().optional().catch(undefined),
  steps: z.array(z.json()).optional().catch(undefined),
  trigger: GeneratedTriggerSchema.optional().catch(undefined),
});

type GeneratedAutomationPayload = z.infer<
  typeof GeneratedAutomationPayloadSchema
>;

export function parseAutomationResponse(
  raw: string,
  request: { prompt: string; tools: ToolDefinition[] }
): AutomationDefinition {
  const payload = extractJsonObject(raw);
  const allowedTools = new Set(request.tools.map((tool) => tool.name));

  const name = sanitizeName(payload.name, request.prompt);
  const description = sanitizeDescription(payload.description, request.prompt);
  const trigger = parseTrigger(payload.trigger);
  const steps = parseSteps(payload.steps, allowedTools);
  const delivery = parseDelivery(payload.delivery);

  const automation: AutomationDefinition = {
    description,
    id: createId("automation"),
    name,
    prompt: request.prompt,
    steps,
    trigger,
    version: 1,
  };

  if (delivery) {
    automation.delivery = delivery;
  }

  return automation;
}

function extractJsonObject(raw: string): GeneratedAutomationPayload {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();

  const candidate = fenced ?? trimmed;

  try {
    const payload = GeneratedAutomationPayloadSchema.safeParse(
      JSON.parse(candidate)
    );

    return payload.success ? payload.data : {};
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");

    if (start >= 0 && end > start) {
      const payload = GeneratedAutomationPayloadSchema.safeParse(
        JSON.parse(candidate.slice(start, end + 1))
      );

      return payload.success ? payload.data : {};
    }

    throw new Error("Agent response did not contain valid JSON.");
  }
}

function sanitizeName(value: string | undefined, prompt: string): string {
  if (value?.trim()) {
    return value.trim().slice(0, 60);
  }

  return deriveName(prompt);
}

function sanitizeDescription(
  value: string | undefined,
  prompt: string
): string {
  if (value?.trim()) {
    return value.trim();
  }

  return prompt.trim();
}

function parseTrigger(
  value: GeneratedAutomationPayload["trigger"]
): AutomationTrigger {
  if (!value) {
    return { type: "manual" };
  }

  if (value.type === "schedule") {
    return {
      cron: value.cron.trim(),
      timezone: value.timezone?.trim(),
      type: "schedule",
    };
  }

  return {
    at: value.at.trim(),
    timezone: value.timezone?.trim(),
    type: "runAt",
  };
}

function parseSteps(
  value: GeneratedAutomationPayload["steps"],
  allowedTools: Set<string>
): AutomationStep[] {
  if (!value) {
    return [];
  }

  const steps: AutomationStep[] = [];

  for (const item of value) {
    const parsedStep = GeneratedStepSchema.safeParse(item);

    if (!parsedStep.success) {
      continue;
    }

    const step = parsedStep.data;
    const tool = step.tool?.trim() ?? "";

    if (!(tool && allowedTools.has(tool))) {
      continue;
    }

    steps.push({
      id: createId("step"),
      input: step.input ?? {},
      tool,
    });
  }

  return steps;
}

function parseDelivery(
  value: GeneratedAutomationPayload["delivery"]
): AutomationDelivery | undefined {
  return normalizeAutomationDelivery(value);
}

function deriveName(text: string): string {
  const line = text.split(/\r?\n/)[0]?.trim() ?? "";

  if (!line) {
    return "New automation";
  }

  return line.replace(/[.?!].*$/, "").slice(0, 60) || "New automation";
}
