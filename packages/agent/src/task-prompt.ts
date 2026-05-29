import type { ProviderClient } from "@tinyclaw/core";
import { normalizeTaskPrompt } from "@tinyclaw/core";

export interface DraftTaskPromptInput {
  title: string;
  description?: string;
}

const TASK_PROMPT_SYSTEM = [
  "You write agent prompts for TinyClaw task runs.",
  "Given a task title and optional board description, produce a single plain-text prompt the agent will execute.",
  "",
  "Rules:",
  "- Return only the prompt text",
  '- Do not return JSON like {"prompt":"..."}',
  "- Do not add labels, markdown fences, or surrounding quotes",
  "- Start directly with the instruction",
  "- Use clear imperative instructions",
  "- Be specific about deliverables and format when helpful",
  "- Keep it concise (roughly 2–6 sentences)",
  "- Do not mention TinyClaw, profiles, or the board UI",
].join("\n");

export function buildTaskPromptUserPrompt(title: string, description?: string): string {
  const lines = [`Title: ${title}`];

  const trimmedDescription = description?.trim();

  if (trimmedDescription) {
    lines.push(`Description: ${trimmedDescription}`);
  }

  return lines.join("\n");
}

export function fallbackTaskPrompt(title: string, description?: string): string {
  const parts = [`Complete the following task: ${title}`];
  const trimmedDescription = description?.trim();

  if (trimmedDescription) {
    parts.push(`Context: ${trimmedDescription}`);
  }

  parts.push("Summarize your findings and list any recommended next steps.");

  return parts.join("\n\n");
}

export async function draftTaskPromptFromFields(
  input: DraftTaskPromptInput,
  options: { provider?: ProviderClient },
): Promise<string> {
  const title = input.title.trim();

  if (!title) {
    throw new Error("Task title is required.");
  }

  const fallback = () => fallbackTaskPrompt(title, input.description);

  if (!options.provider) {
    return fallback();
  }

  try {
    const raw = await options.provider.generateText({
      system: TASK_PROMPT_SYSTEM,
      prompt: buildTaskPromptUserPrompt(title, input.description),
      format: "text",
    });
    const prompt = normalizeTaskPrompt(raw);

    return prompt || fallback();
  } catch {
    return fallback();
  }
}
