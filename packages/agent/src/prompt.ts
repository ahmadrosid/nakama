import type { AgentChannel, ToolDefinition } from "@nakama/core";

export function buildAutomationSystemPrompt(tools: ToolDefinition[]): string {
  const toolCatalog =
    tools.length > 0
      ? tools
          .map((tool) => `- ${tool.name}: ${tool.description}`)
          .join("\n")
      : "- No tools are available.";

  return [
    "You are Nakama, an automation planner.",
    "Convert the user's request into a JSON automation definition.",
    "Use only tools from the catalog below.",
    "Prefer schedule triggers when the user mentions recurring timing.",
    "Use manual trigger when the user wants an on-demand automation.",
    "",
    "Return JSON with this shape:",
    "{",
    '  "name": "short title",',
    '  "description": "one sentence summary",',
    '  "trigger": { "type": "manual" } | { "type": "schedule", "cron": "0 8 * * *", "timezone": "UTC" },',
    '  "steps": [{ "tool": "tool_name", "input": { } }],',
    '  "delivery": { "channel": "telegram" | "whatsapp" | "email", "to": "user@example.com", "notifyOn": "success" | "failure" | "both" }',
    "}",
    "",
    "Rules:",
    "- steps must use only listed tool names",
    "- cron must be valid 5-field cron syntax",
    "- keep steps minimal and practical",
    "- do not include ids or version fields",
    "- include delivery only when the user asks to send run results somewhere",
    "- when delivery.channel is email, delivery.to is required",
    "- when delivery is set, keep the task itself in the automation prompt and do not repeat delivery instructions there",
    "",
    "Available tools:",
    toolCatalog,
  ].join("\n");
}

export function buildAutomationUserPrompt(
  prompt: string,
  channel: AgentChannel,
): string {
  return [
    `Channel: ${channel}`,
    "User request:",
    prompt,
  ].join("\n");
}
