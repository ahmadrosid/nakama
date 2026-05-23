import { draftAutomation } from "./automation/generator";
import {
  type AutomationDefinition,
  type AutomationTrigger,
  type ToolDefinition,
} from "@tinyclaw/core";
import { deriveName } from "./parse";

export function createFallbackAutomation(
  request: { prompt: string; tools: ToolDefinition[] },
): AutomationDefinition {
  const automation = draftAutomation({
    prompt: request.prompt,
    name: deriveName(request.prompt),
  });

  return {
    ...automation,
    trigger: inferTrigger(request.prompt),
    steps: inferSteps(request.prompt, request.tools),
  };
}

function inferTrigger(prompt: string): AutomationTrigger {
  const text = prompt.toLowerCase();

  if (/\bevery hour\b|\bhourly\b/.test(text)) {
    return { type: "schedule", cron: "0 * * * *", timezone: "UTC" };
  }

  if (/\bevery week\b|\bweekly\b/.test(text)) {
    return { type: "schedule", cron: "0 9 * * 1", timezone: "UTC" };
  }

  if (/\bevery day\b|\bdaily\b|\beach morning\b|\bevery morning\b/.test(text)) {
    return { type: "schedule", cron: "0 8 * * *", timezone: "UTC" };
  }

  return { type: "manual" };
}

function inferSteps(
  _prompt: string,
  _tools: ToolDefinition[],
): AutomationDefinition["steps"] {
  return [];
}
