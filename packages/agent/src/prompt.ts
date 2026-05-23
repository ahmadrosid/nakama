import type { ToolDefinition } from "@tinyclaw/core";

export function buildAutomationSystemPrompt(tools: ToolDefinition[]): string {
  const toolCatalog =
    tools.length > 0
      ? tools
          .map((tool) => `- ${tool.name}: ${tool.description}`)
          .join("\n")
      : "- No tools are available.";

  return [
    "You are TinyClaw, an automation planner.",
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
    '  "steps": [{ "tool": "tool_name", "input": { } }]',
    "}",
    "",
    "Rules:",
    "- steps must use only listed tool names",
    "- cron must be valid 5-field cron syntax",
    "- keep steps minimal and practical",
    "- do not include ids or version fields",
    "",
    "Available tools:",
    toolCatalog,
  ].join("\n");
}

export function buildAutomationUserPrompt(
  prompt: string,
  channel: "web" | "cli" | "telegram",
): string {
  return [
    `Channel: ${channel}`,
    "User request:",
    prompt,
  ].join("\n");
}
