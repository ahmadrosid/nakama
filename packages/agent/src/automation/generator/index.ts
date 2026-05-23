import { createId, type AutomationDefinition } from "@tinyclaw/core";

export interface GenerateAutomationInput {
  prompt: string;
  name?: string;
}

export function draftAutomation(
  input: GenerateAutomationInput,
): AutomationDefinition {
  return {
    id: createId("automation"),
    name: input.name ?? "New automation",
    description: input.prompt,
    prompt: input.prompt,
    trigger: { type: "manual" },
    steps: [],
    version: 1,
  };
}
