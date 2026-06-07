import type { ToolDefinition } from "@tinyclaw/core";
import type { AgentRequest } from "./chat";

export function buildChatSystemPrompt(
  tools: ToolDefinition[],
  options: {
    basePrompt?: string;
    userContext?: string;
    enableToolLoop?: boolean;
    soul?: boolean;
    userTimezone?: string;
    channel?: AgentRequest["channel"];
  } = {},
): string {
  const sections = [
    options.basePrompt?.trim() ||
      "You are TinyClaw, a helpful personal AI assistant.",
  ];

  if (options.userContext?.trim()) {
    sections.push("", "# About the User (USER.md)", options.userContext.trim());
  }

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
    "When the user asks to run or test a saved automation, use list_automations to find it, then run_automation, and summarize the result.",
    "For scheduled automations, use 5-field cron syntax and include the timezone when it differs from the user's timezone.",
  );

  if (options.enableToolLoop && tools.length > 0) {
    sections.push(
      "",
      "You have access to tools for this session. Use them when needed, then reply to the user in natural language unless another tool call is required.",
    );

    if (tools.some((tool) => tool.name === "todo_write")) {
      sections.push(
        "For complex requests with 3+ distinct steps, call todo_write first to break the work into a task plan.",
        "Keep exactly one todo in_progress at a time, mark todos completed immediately after finishing them, and use merge: true for incremental updates.",
        "Use merge: false only when replacing the entire task plan.",
        "When an active task plan is present in your context, continue unfinished tasks on the next turn before taking on new work unless the user changes direction.",
      );
    }
  }

  if (options.channel === "telegram") {
    sections.push(
      "",
      "You are replying in a private Telegram chat. Telegram does not render Markdown.",
      "Use plain text only: no markdown, no HTML, no formatting syntax.",
      "Do not use **bold**, *italic*, # headings, bullet lists with - or *, numbered markdown lists, tables, or ``` code fences.",
      "Write like texting a friend: short paragraphs and a conversational tone.",
      "Prefer one to three brief paragraphs unless the user asks for detail.",
      "If you must share code or commands, put them on their own line as plain text without backticks.",
      "Do not mention tools, JSON, or internal steps in the user-visible reply.",
    );
  }

  return sections.join("\n");
}
