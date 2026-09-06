import type { ChatMessage, ProviderClient } from "@nakama/core";
import { getUserMessageText } from "@nakama/core";

const SNIPPET_MAX_LENGTH = 500;
const FALLBACK_TITLE_MAX_LENGTH = 60;

const SESSION_TITLE_SYSTEM = [
  "You write short titles for chat conversations.",
  "Given the opening user message and assistant reply, return a plain 3–5 word phrase that captures the topic.",
  "",
  "Rules:",
  "- Return only the title text",
  "- No quotes, markdown, punctuation at the ends, or JSON",
  "- Use title case when natural",
  "- Do not mention Nakama or that this is a chat title",
].join("\n");

function truncateSnippet(
  value: string,
  maxLength = SNIPPET_MAX_LENGTH
): string {
  const trimmed = value.trim();

  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength).trimEnd()}…`;
}

function extractUserSnippet(
  message: Extract<ChatMessage, { role: "user" }>
): string {
  const content = message.content;
  const text = getUserMessageText(content).trim();

  if (text) {
    return truncateSnippet(text);
  }

  return Array.isArray(content) ? "[image]" : "";
}

function extractAssistantSnippet(
  message: Extract<ChatMessage, { role: "assistant" }>
): string {
  return truncateSnippet(message.content);
}

export function buildSessionTitlePrompt(
  messages: readonly ChatMessage[]
): string | null {
  const firstUserIndex = messages.findIndex(
    (message) => message.role === "user"
  );

  if (firstUserIndex === -1) {
    return null;
  }

  const firstUser = messages[firstUserIndex] as Extract<
    ChatMessage,
    { role: "user" }
  >;
  const userSnippet = extractUserSnippet(firstUser);

  if (!userSnippet) {
    return null;
  }

  const firstAssistant = messages
    .slice(firstUserIndex + 1)
    .find(
      (message): message is Extract<ChatMessage, { role: "assistant" }> =>
        message.role === "assistant" && message.content.trim().length > 0
    );

  const lines = [`User: ${userSnippet}`];

  if (firstAssistant) {
    lines.push(`Assistant: ${extractAssistantSnippet(firstAssistant)}`);
  }

  return lines.join("\n");
}

function fallbackSessionTitleFromMessages(
  messages: readonly ChatMessage[]
): string | null {
  const firstUser = messages.find(
    (message): message is Extract<ChatMessage, { role: "user" }> =>
      message.role === "user"
  );

  if (!firstUser) {
    return null;
  }

  const text =
    getUserMessageText(firstUser.content).trim().split("\n")[0] ?? "";

  if (!text.trim()) {
    return Array.isArray(firstUser.content) ? "Image" : null;
  }

  return normalizeSessionTitle(
    truncateSnippet(text, FALLBACK_TITLE_MAX_LENGTH)
  );
}

export function normalizeSessionTitle(raw: string): string | null {
  let value = raw.trim();

  if (!value) {
    return null;
  }

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }

  value = value.replace(/\s+/g, " ").trim();

  return value || null;
}

export async function generateSessionTitleFromMessages(
  messages: readonly ChatMessage[],
  options: { provider?: ProviderClient }
): Promise<string | null> {
  const prompt = buildSessionTitlePrompt(messages);
  const fallback = fallbackSessionTitleFromMessages(messages);

  if (!(prompt && options.provider)) {
    return fallback;
  }

  try {
    const result = await options.provider.generateText({
      format: "text",
      prompt,
      system: SESSION_TITLE_SYSTEM,
    });

    return normalizeSessionTitle(result.content) ?? fallback;
  } catch {
    return fallback;
  }
}
