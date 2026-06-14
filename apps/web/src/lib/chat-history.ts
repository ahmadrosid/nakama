import type {
  ChatMessage,
  MessageContentPart,
  SessionMessageMeta,
} from "@tinyclaw/core/contract";
import { extractThinkingFromAssistantMessage } from "@tinyclaw/core/thinking-content";
import { userContentToDisplayDocuments, userContentToDisplayImages } from "@/lib/chat-images";

export interface RequestedChatSession {
  profileId: string;
  sessionId: string;
}

export function buildChatBasePath(): string {
  return "/chat";
}

/** Profile id from `?new=1&profile=…` when opening a new chat (e.g. Super Bot from Tools). */
export function readRequestedProfileFromNewChatSearch(search: string): string | null {
  const params = new URLSearchParams(search);
  if (params.get("new") !== "1") {
    return null;
  }

  const profileId = params.get("profile")?.trim();
  return profileId || null;
}

export function chatProfileIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/chat\/([^/]+)\//);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function buildChatPath(profileId: string, sessionId: string): string {
  return `/chat/${encodeURIComponent(profileId)}/${encodeURIComponent(sessionId)}`;
}

export function parseChatRouteParams(params: {
  profileId?: string;
  sessionId?: string;
}): RequestedChatSession | null {
  const { profileId, sessionId } = params;

  if (!profileId || !sessionId) {
    return null;
  }

  return { profileId, sessionId };
}

export interface ChatListItem {
  id: string;
  historyIndex?: number;
  createdAt?: string;
  role: "user" | "assistant" | "tool";
  content: string;
  thinking?: string;
  thinkingStreaming?: boolean;
  images?: Array<{ url: string; mediaType: string }>;
  documents?: Array<{ filename: string; mediaType: string }>;
  streaming?: boolean;
  toolCallId?: string;
  tool?: string;
  toolStatus?: "running" | "done";
  toolInput?: Record<string, unknown>;
  toolResult?: unknown;
}

export function sessionStorageKey(profileId: string): string {
  return `tinyclaw:session:${profileId}`;
}

function parseToolResult(content: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return content;
  }
}

export function chatMessagesToListItems(
  messages: ChatMessage[],
  messageMeta: SessionMessageMeta[] = [],
): ChatListItem[] {
  const toolInputs = new Map<string, Record<string, unknown>>();

  for (const message of messages) {
    if (message.role !== "assistant") {
      continue;
    }

    for (const call of message.toolCalls ?? []) {
      toolInputs.set(call.id, call.arguments);
    }
  }

  const items: ChatListItem[] = [];

  for (const [index, message] of messages.entries()) {
    const meta = messageMeta[index];

    if (message.role === "user") {
      const content = message.content;
      const text =
        typeof content === "string"
          ? content
          : content
              .filter((part): part is Extract<MessageContentPart, { type: "text" }> => part.type === "text")
              .map((part) => part.text)
              .join("\n");

      items.push({
        id: `history-${index}`,
        historyIndex: index,
        createdAt: meta?.createdAt,
        role: "user",
        content: text,
        images: userContentToDisplayImages(content),
        documents: userContentToDisplayDocuments(content),
      });
      continue;
    }

    if (message.role === "assistant") {
      if (!message.content.trim() && message.toolCalls?.length) {
        continue;
      }

      const thinking = extractThinkingFromAssistantMessage(message);

      items.push({
        id: `history-${index}`,
        historyIndex: index,
        createdAt: meta?.createdAt,
        role: "assistant",
        content: message.content,
        ...(thinking ? { thinking } : {}),
      });
      continue;
    }

    if (message.role === "tool") {
      items.push({
        id: message.toolCallId,
        historyIndex: index,
        createdAt: meta?.createdAt,
        role: "tool",
        content: `${message.name} completed`,
        toolCallId: message.toolCallId,
        tool: message.name,
        toolStatus: "done",
        toolInput: toolInputs.get(message.toolCallId),
        toolResult: parseToolResult(message.content),
      });
    }
  }

  return items;
}

export function formatSessionTimestamp(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatSessionRelativeTime(value: string): string {
  return formatRelativeTime(value, "past");
}

export function formatFutureRelativeTime(value: string): string {
  return formatRelativeTime(value, "future");
}

function formatRelativeTime(value: string, tense: "past" | "future"): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const deltaMs =
    tense === "future" ? date.getTime() - Date.now() : Date.now() - date.getTime();

  if (tense === "future" && deltaMs <= 0) {
    return formatSessionTimestamp(value);
  }

  const seconds = Math.max(0, Math.round(deltaMs / 1000));

  if (seconds < 60) {
    return tense === "future" ? "in less than a minute" : "just now";
  }

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return tense === "future" ? `in ${minutes}m` : `${minutes}m ago`;
  }

  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return tense === "future" ? `in ${hours}h` : `${hours}h ago`;
  }

  const days = Math.round(hours / 24);
  if (days < 7) {
    return tense === "future" ? `in ${days}d` : `${days}d ago`;
  }

  return formatSessionTimestamp(value);
}
