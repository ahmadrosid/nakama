import type {
  AgentChannel,
  AgentQuestionAnswer,
  ChatMessage,
  SessionMessageMeta,
} from "@nakama/core/contract";
import { parseAgentQuestionnaireAnswersMessage } from "@nakama/core/agent-questionnaire";
import { extractThinkingFromAssistantMessage } from "@nakama/core/thinking-content";
import { userContentToDisplayDocuments, userContentToDisplayImageAttachments, userContentToDisplayImages, stripImageDescriptionsFromDisplayText } from "@/lib/chat-images";
import {
  extractWebSearchBlocksFromProviderContent,
  WEB_SEARCH_TOOL_NAME,
} from "@/lib/chat-stream-web-search";

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

/** Draft message from `?new=1&draft=…` when opening a new chat. */
export function readRequestedDraftFromNewChatSearch(search: string): string | null {
  const params = new URLSearchParams(search);
  if (params.get("new") !== "1") {
    return null;
  }

  const draft = params.get("draft");
  return draft ?? null;
}

/** Session-storage draft key from `?new=1&draftKey=…`. */
export function readRequestedDraftKeyFromNewChatSearch(search: string): string | null {
  const params = new URLSearchParams(search);
  if (params.get("new") !== "1") {
    return null;
  }

  const draftKey = params.get("draftKey")?.trim();
  return draftKey || null;
}

export const CHAT_DRAFT_STORAGE_PREFIX = "nakama:chat-draft:";

export function consumeStoredChatDraft(key: string): string | null {
  if (typeof sessionStorage === "undefined") {
    return null;
  }

  const value = sessionStorage.getItem(`${CHAT_DRAFT_STORAGE_PREFIX}${key}`);

  if (value !== null) {
    sessionStorage.removeItem(`${CHAT_DRAFT_STORAGE_PREFIX}${key}`);
  }

  return value;
}

export function storeChatDraft(draft: string): string {
  const key = `d${Date.now()}`;
  sessionStorage.setItem(`${CHAT_DRAFT_STORAGE_PREFIX}${key}`, draft);
  return key;
}

export const MAX_URL_CHAT_DRAFT_LENGTH = 1500;

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
  imageAttachments?: Array<{ url?: string; mediaType: string; description?: string | null }>;
  documents?: Array<{ filename: string; mediaType: string }>;
  questionnaireAnswers?: AgentQuestionAnswer[];
  streaming?: boolean;
  toolCallId?: string;
  tool?: string;
  toolStatus?: "running" | "done";
  toolInput?: Record<string, unknown>;
  toolInputAccumulatedJson?: string;
  artifactStreaming?: boolean;
  toolResult?: unknown;
}

export function sessionStorageKey(profileId: string): string {
  return `nakama:session:${profileId}`;
}

export const HISTORY_SESSION_CHANNELS = ["web", "telegram", "whatsapp"] as const satisfies readonly AgentChannel[];

export function isReadOnlySessionChannel(channel: AgentChannel): boolean {
  return channel === "telegram" || channel === "whatsapp";
}

export function formatSessionChannelLabel(channel: AgentChannel): string {
  switch (channel) {
    case "telegram":
      return "Telegram";
    case "whatsapp":
      return "WhatsApp";
    case "web":
      return "Web";
    default:
      return channel;
  }
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
  const hydratedToolCallIds = new Set<string>();
  const persistedWebSearchToolIds = new Set<string>();

  for (const message of messages) {
    if (message.role === "tool" && message.name === WEB_SEARCH_TOOL_NAME) {
      persistedWebSearchToolIds.add(message.toolCallId);
    }
  }

  for (const [index, message] of messages.entries()) {
    const meta = messageMeta[index];

    if (message.role === "user") {
      const content = message.content;
      const text = stripImageDescriptionsFromDisplayText(content);
      const images = userContentToDisplayImages(content);
      const imageAttachments = userContentToDisplayImageAttachments(content);
      const documents = userContentToDisplayDocuments(content);
      const questionnaireAnswers =
        typeof content === "string" ? parseAgentQuestionnaireAnswersMessage(content) : null;

      items.push({
        id: `history-${index}`,
        historyIndex: index,
        createdAt: meta?.createdAt,
        role: "user",
        content: text,
        ...(images.length > 0 ? { images } : {}),
        ...(imageAttachments.length > 0 ? { imageAttachments } : {}),
        ...(documents.length > 0 ? { documents } : {}),
        ...(questionnaireAnswers ? { questionnaireAnswers } : {}),
      });
      continue;
    }

    if (message.role === "assistant") {
      if (!message.content.trim() && message.toolCalls?.length) {
        continue;
      }

      for (const block of extractWebSearchBlocksFromProviderContent(message.providerContent)) {
        if (
          hydratedToolCallIds.has(block.toolCallId) ||
          persistedWebSearchToolIds.has(block.toolCallId)
        ) {
          continue;
        }

        hydratedToolCallIds.add(block.toolCallId);
        items.push({
          id: block.toolCallId,
          historyIndex: index,
          createdAt: meta?.createdAt,
          role: "tool",
          content: `${WEB_SEARCH_TOOL_NAME} completed`,
          toolCallId: block.toolCallId,
          tool: WEB_SEARCH_TOOL_NAME,
          toolStatus: "done",
          toolInput: block.query ? { query: block.query } : undefined,
          toolResult: block.result,
        });
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
      hydratedToolCallIds.add(message.toolCallId);
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
