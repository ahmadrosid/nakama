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
    chatKind?: "private" | "group";
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
    "Use create_automation to save recurring, one-time, or manual automations after confirming the schedule with the user.",
    "When the user asks to run or test a saved automation, use list_automations to find it, then run_automation, and summarize the result.",
    "For recurring tasks, use trigger type schedule with 5-field cron syntax and include timezone when it differs from the user's timezone.",
    "For one-time reminders (e.g. \"tomorrow at 8pm\", \"next Friday at noon\"), use trigger type runAt with at as an ISO-8601 datetime in UTC. Never use day-of-week-only cron for a specific date.",
    "Scheduled automation runs do not reply in chat. For reminders, write the prompt to deliver the message (e.g. use the email tool to send to an address the user gave).",
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

    if (tools.some((tool) => tool.name === "ask_user_question")) {
      sections.push(
        "Use ask_user_question when you need missing information before you can continue.",
        "Ask one concise batch at a time, prefer predefined choices when possible, and wait for the user's answers before proceeding.",
      );
    }

    if (tools.some((tool) => tool.name === "update_profile_memory")) {
      sections.push(
        "Use update_profile_memory to record facts, preferences, and personal context — things you know about the user. Do not use it for step-by-step procedures; use create_skill for those.",
      );
    }

    if (tools.some((tool) => tool.name === "create_skill")) {
      sections.push(
        "Use create_skill to save step-by-step workflows and repeatable procedures — actions you execute for the user. Do not use it for facts or observations; use update_profile_memory for those.",
      );
    }
  }

  if (options.channel === "telegram" || options.channel === "whatsapp") {
    appendMessagingChannelPrompt(sections, options.channel, options.chatKind ?? "private");
  }

  return sections.join("\n");
}

function appendMessagingChannelPrompt(
  sections: string[],
  channel: "telegram" | "whatsapp",
  chatKind: "private" | "group",
): void {
  const platform = channel === "telegram" ? "Telegram" : "WhatsApp";

  if (chatKind === "group" && channel === "telegram") {
    sections.push(
      "",
      "You are replying in a Telegram group chat. Everyone in the group can see your messages.",
    );
  } else {
    sections.push("", `You are replying in a private ${platform} chat.`);
  }

  if (channel === "telegram") {
    sections.push(
      "Telegram does not render Markdown.",
      "Use plain text only: no markdown, no HTML, no formatting syntax.",
      "Do not use **bold**, *italic*, # headings, bullet lists with - or *, numbered markdown lists, tables, or ``` code fences.",
    );
  } else {
    sections.push(
      "WhatsApp only supports simple *bold* and _italic_ formatting.",
      "Do not use markdown headings, bullet lists, numbered lists, tables, or ``` code fences.",
    );
  }

  sections.push(
    "Write like texting a friend: short paragraphs and a conversational tone.",
    "Prefer one to three brief paragraphs unless the user asks for detail.",
    "If you must share code or commands, put them on their own line as plain text without backticks.",
    "Do not mention tools, JSON, or internal steps in the user-visible reply.",
  );
}
