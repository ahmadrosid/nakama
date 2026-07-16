import type { ToolDefinition } from "@nakama/core";
import type { AgentRequest } from "./chat";

type MessagingChannel = "telegram" | "whatsapp" | "discord";

type MessagingChannelPromptConfig = {
  label: string;
  supportsGroupAudience: boolean;
  format: readonly string[];
};

const MESSAGING_CHANNEL_PROMPT = {
  telegram: {
    label: "Telegram",
    supportsGroupAudience: true,
    format: [
      "Write in normal Markdown when formatting helps; Telegram delivery will render a safe rich subset.",
      "Use simple Markdown: **bold**, *italic*, __underline__, inline code, fenced code blocks, headings, links, and short lists.",
      "Avoid raw HTML, Markdown tables, deeply nested lists, and very long code blocks because Telegram is best for compact chat messages.",
    ],
  },
  whatsapp: {
    label: "WhatsApp",
    supportsGroupAudience: false,
    format: [
      "WhatsApp only supports simple *bold* and _italic_ formatting.",
      "Do not use markdown headings, bullet lists, numbered lists, tables, or ``` code fences.",
    ],
  },
  discord: {
    label: "Discord",
    supportsGroupAudience: true,
    format: [
      "Discord supports a Markdown subset: **bold**, *italic*, __underline__, ~~strikethrough~~, inline code, fenced code blocks, and headings.",
      "Avoid tables and very long code blocks; keep messages compact for chat.",
    ],
  },
} as const satisfies Record<MessagingChannel, MessagingChannelPromptConfig>;

const SHARED_MESSAGING_STYLE = [
  "Write like texting a friend: short paragraphs and a conversational tone.",
  "Prefer one to three brief paragraphs unless the user asks for detail.",
  "If you must share code or commands, put them on their own line as plain text without backticks.",
  "Do not mention tools, JSON, or internal steps in the user-visible reply.",
] as const;

function isMessagingChannel(
  channel: AgentRequest["channel"] | undefined,
): channel is MessagingChannel {
  return channel !== undefined && channel in MESSAGING_CHANNEL_PROMPT;
}

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
    "You are Nakama, a helpful personal AI assistant.",
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

    if (
      tools.some((tool) => tool.name === "read_file") &&
      tools.some((tool) => tool.name === "edit_file")
    ) {
      sections.push(
        "Use the update-profile-memory skill when it is active to record facts, preferences, and personal context in MEMORY.md — things you know about the user. Do not use MEMORY.md for step-by-step procedures; use profile skills for those.",
        "When MEMORY.md is full or the user wants to remove facts without deleting them, follow the archive-profile-memory skill when it is active. Archived facts live under memory-archive/ and are not loaded automatically; use search_files or read_file to retrieve them when relevant.",
      );
    }

    if (tools.some((tool) => tool.name === "write_file")) {
      sections.push(
        "Skills are workflow instructions, not callable tools — never invoke save-artifact (or other skills) as a tool.",
        "When the user wants output kept or mentions artifacts, use write_file to save under artifacts/ (follow the save-artifact skill when active, including the metadata sidecar). Durable deliverables such as reports, slide decks, and exports belong under artifacts/, not the profile workspace root.",
        "Do not use artifacts/ for soul files or MEMORY.md.",
      );
    }

    if (tools.some((tool) => tool.name === "write_docx")) {
      sections.push(
        "When the user asks for a Word document, use write_docx with Markdown content. Never write HTML or WordprocessingML to a .docx or .doc path with write_file — those formats are archives, not text, and Word will show the markup as raw text.",
      );
    }
  }

  if (isMessagingChannel(options.channel)) {
    appendMessagingChannelPrompt(sections, options.channel, options.chatKind ?? "private");
  }

  return sections.join("\n");
}

function appendMessagingChannelPrompt(
  sections: string[],
  channel: MessagingChannel,
  chatKind: "private" | "group",
): void {
  const config = MESSAGING_CHANNEL_PROMPT[channel];
  const audienceLine =
    chatKind === "group" && config.supportsGroupAudience
      ? `You are replying in a ${config.label} channel. Everyone in the channel can see your messages.`
      : `You are replying in a private ${config.label} chat.`;

  sections.push("", audienceLine, ...config.format, ...SHARED_MESSAGING_STYLE);
}
