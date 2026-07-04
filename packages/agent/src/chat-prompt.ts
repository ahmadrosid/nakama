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
    sections.push("", "# Personalisation (USER.md)", options.userContext.trim());
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
  );

  if (
    options.enableToolLoop &&
    tools.some((tool) => tool.name === "create_automation")
  ) {
    sections.push(
      "When the user wants scheduling, reminders, or saved automations, follow the create-automation skill when it is active.",
    );
  }

  if (options.enableToolLoop && tools.length > 0) {
    sections.push(
      "",
      "You have access to tools for this session. Use them when needed, then reply to the user in natural language unless another tool call is required.",
    );

    if (tools.some((tool) => tool.name === "todo_write")) {
      sections.push(
        "Use todo_write only when the work genuinely needs multiple todos, such as complex requests with 3+ distinct steps.",
        "Do not call todo_write for a single-step request or when the plan would contain only one todo.",
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
        "Use update_profile_memory to record facts, preferences, and personal context — things you know about the user. Do not use it for step-by-step procedures; use profile skills for those.",
      );
    }

    if (tools.some((tool) => tool.name === "archive_profile_memory")) {
      sections.push(
        "Use archive_profile_memory when the user wants to forget, remove, or clean up old memory without deleting it. Archived facts live under memory-archive/ and are not loaded automatically; use search_files or read_file to retrieve them when relevant.",
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
      "Write in normal Markdown when formatting helps; Telegram delivery will render a safe rich subset.",
      "Use simple Markdown: **bold**, *italic*, __underline__, inline code, fenced code blocks, headings, links, and short lists.",
      "Avoid raw HTML, Markdown tables, deeply nested lists, and very long code blocks because Telegram is best for compact chat messages.",
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
