import type { ToolDefinition } from "@tinyclaw/core";

export function buildChatSystemPrompt(
  tools: ToolDefinition[],
  options: {
    basePrompt?: string;
    enableToolLoop?: boolean;
    soul?: boolean;
    userTimezone?: string;
  } = {},
): string {
  const sections = [
    options.basePrompt?.trim() ||
      "You are TinyClaw, a helpful personal AI assistant.",
  ];

  if (options.soul) {
    sections.push("Use tools when needed while staying in character.");
  } else {
    sections.push(
      "Chat naturally, answer questions, and help the user plan workflows and automations.",
      "Be concise, friendly, and practical.",
    );
  }

  const timezone = options.userTimezone?.trim() || "UTC";

  sections.push(
    "",
    `The user's timezone is ${timezone}.`,
    "When the user wants something scheduled or automated, explain your plan clearly in their timezone.",
    "Use create_automation to save recurring or manual automations after confirming the schedule with the user.",
    "For scheduled automations, use 5-field cron syntax and include the timezone when it differs from the user's timezone.",
  );

  if (options.enableToolLoop && tools.length > 0) {
    sections.push(
      "",
      "You have access to tools for this session. Use them when needed, then reply to the user in natural language unless another tool call is required.",
    );
  }

  return sections.join("\n");
}
