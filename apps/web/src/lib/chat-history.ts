import { parseAgentQuestionnaireAnswersMessage } from "@nakama/core/agent-questionnaire";
import type {
  AgentChannel,
  AgentQuestionAnswer,
  ChatMessage,
  SessionMessageMeta,
} from "@nakama/core/contract";
import { extractThinkingFromAssistantMessage } from "@nakama/core/thinking-content";
import {
  stripImageDescriptionsFromDisplayText,
  userContentToDisplayDocuments,
  userContentToDisplayImageAttachments,
  userContentToDisplayImages,
} from "@/lib/chat-images";
import {
  extractWebSearchBlocksFromProviderContent,
  WEB_SEARCH_TOOL_NAME,
} from "@/lib/chat-stream-web-search";
import { createClientId } from "@/lib/client-id";

export interface RequestedChatSession {
  profileId: string;
  sessionId: string;
}

export function buildChatBasePath(): string {
  return "/chat";
}

/**
 * Draft chat URL used when starting a new chat (or switching profiles while on a
 * session route). `/chat` and `/chat/:profileId/:sessionId` are separate routes,
 * so navigating between them remounts ChatPage — the profile must travel in the
 * query string or the remounted page falls back to the default profile.
 */
export function buildNewChatPath(profileId?: string | null): string {
  const params = new URLSearchParams({ new: "1" });
  if (profileId) {
    params.set("profile", profileId);
  }
  return `${buildChatBasePath()}?${params.toString()}`;
}

/** Profile id from `?new=1&profile=…` when opening a new chat (e.g. Super Bot from Tools). */
export function readRequestedProfileFromNewChatSearch(
  search: string
): string | null {
  const params = new URLSearchParams(search);
  if (params.get("new") !== "1") {
    return null;
  }

  const profileId = params.get("profile")?.trim();
  return profileId || null;
}

/** Draft message from `?new=1&draft=…` when opening a new chat. */
export function readRequestedDraftFromNewChatSearch(
  search: string
): string | null {
  const params = new URLSearchParams(search);
  if (params.get("new") !== "1") {
    return null;
  }

  const draft = params.get("draft");
  return draft ?? null;
}

/** Session-storage draft key from `?new=1&draftKey=…`. */
export function readRequestedDraftKeyFromNewChatSearch(
  search: string
): string | null {
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
  const key = createClientId();
  sessionStorage.setItem(`${CHAT_DRAFT_STORAGE_PREFIX}${key}`, draft);
  return key;
}

export const MAX_URL_CHAT_DRAFT_LENGTH = 1500;

export function chatProfileIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/chat\/([^/]+)\//);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function isChatSessionPath(pathname: string): boolean {
  return chatProfileIdFromPath(pathname) !== null;
}

export const ACTIVE_CHAT_PROFILE_STORAGE_KEY = "nakama:active-chat-profile";

export function readStoredActiveChatProfileId(): string | null {
  if (typeof localStorage === "undefined") {
    return null;
  }

  const profileId = localStorage
    .getItem(ACTIVE_CHAT_PROFILE_STORAGE_KEY)
    ?.trim();
  return profileId || null;
}

export function writeStoredActiveChatProfileId(profileId: string): void {
  if (typeof localStorage === "undefined") {
    return;
  }

  localStorage.setItem(ACTIVE_CHAT_PROFILE_STORAGE_KEY, profileId);
}

export function pickKnownProfileId(
  profiles: ReadonlyArray<{ id: string }>,
  ...candidates: Array<string | null | undefined>
): string | null {
  for (const candidate of candidates) {
    if (candidate && profiles.some((profile) => profile.id === candidate)) {
      return candidate;
    }
  }

  return null;
}

/** Initial profile for draft `/chat` before profiles list loads. */
export function readInitialDraftChatProfileId(input: {
  search: string;
  routeProfileId?: string | null;
}): string {
  if (input.routeProfileId) {
    return input.routeProfileId;
  }

  return (
    readRequestedProfileFromNewChatSearch(input.search) ??
    readStoredActiveChatProfileId() ??
    ""
  );
}

/** Profile id for `/history` — URL when present, else live chat state / storage / default. */
export function resolveHistoryProfileId(input: {
  search: string;
  profiles: ReadonlyArray<{ id: string }>;
  liveChatProfileId?: string | null;
}): string | null {
  const fromUrl = new URLSearchParams(input.search).get("profile");
  return (
    pickKnownProfileId(
      input.profiles,
      fromUrl,
      input.liveChatProfileId,
      readStoredActiveChatProfileId()
    ) ?? resolveDefaultProfileId(input.profiles)
  );
}

export function resolveDefaultProfileId(
  profiles: ReadonlyArray<{ id: string }>
): string | null {
  if (profiles.length === 0) {
    return null;
  }

  return (
    profiles.find((profile) => profile.id === "default")?.id ?? profiles[0]!.id
  );
}

export function isProfilesPath(
  pathname: string,
  profilesPath = "/profiles"
): boolean {
  return pathname === profilesPath || pathname.startsWith(`${profilesPath}/`);
}

/** Profile id for `/profiles` — URL when present, else live chat state / storage / default. */
export function resolveProfilesPageProfileId(input: {
  search: string;
  profiles: ReadonlyArray<{ id: string }>;
  liveChatProfileId?: string | null;
}): string | null {
  const fromUrl = new URLSearchParams(input.search).get("profile");
  return (
    pickKnownProfileId(
      input.profiles,
      fromUrl,
      input.liveChatProfileId,
      readStoredActiveChatProfileId()
    ) ?? resolveDefaultProfileId(input.profiles)
  );
}

/** Profile id for sidebar rail highlight — URL when present, else live chat state / storage. */
export function resolveActiveProfileIdFromLocation(input: {
  pathname: string;
  search: string;
  profiles: ReadonlyArray<{ id: string }>;
  liveChatProfileId?: string | null;
  historyPath?: string;
  profilesPath?: string;
}): string | null {
  const {
    pathname,
    search,
    profiles,
    liveChatProfileId,
    historyPath = "/history",
    profilesPath = "/profiles",
  } = input;

  const isKnownProfile = (
    profileId: string | null | undefined
  ): profileId is string =>
    Boolean(profileId && profiles.some((profile) => profile.id === profileId));

  if (pathname === historyPath) {
    return resolveHistoryProfileId({ liveChatProfileId, profiles, search });
  }

  if (isProfilesPath(pathname, profilesPath)) {
    return resolveProfilesPageProfileId({
      liveChatProfileId,
      profiles,
      search,
    });
  }

  const fromSessionPath = chatProfileIdFromPath(pathname);
  if (isKnownProfile(fromSessionPath)) {
    return fromSessionPath;
  }

  const fromNewChat = readRequestedProfileFromNewChatSearch(search);
  if (isKnownProfile(fromNewChat)) {
    return fromNewChat;
  }

  if (pathname === buildChatBasePath()) {
    if (isKnownProfile(liveChatProfileId)) {
      return liveChatProfileId;
    }
    const stored = readStoredActiveChatProfileId();
    if (isKnownProfile(stored)) {
      return stored;
    }
    return resolveDefaultProfileId(profiles);
  }

  if (isKnownProfile(liveChatProfileId)) {
    return liveChatProfileId;
  }

  const stored = readStoredActiveChatProfileId();
  if (isKnownProfile(stored)) {
    return stored;
  }

  return null;
}

export function buildChatPath(profileId: string, sessionId: string): string {
  return `/chat/${encodeURIComponent(profileId)}/${encodeURIComponent(sessionId)}`;
}

export function parseChatRouteParams(params: {
  profileId?: string;
  sessionId?: string;
}): RequestedChatSession | null {
  const { profileId, sessionId } = params;

  if (!(profileId && sessionId)) {
    return null;
  }

  return { profileId, sessionId };
}

export interface ChatListItem {
  artifactStreaming?: boolean;
  content: string;
  createdAt?: string;
  documents?: Array<{ filename: string; mediaType: string }>;
  historyIndex?: number;
  id: string;
  imageAttachments?: Array<{
    url?: string;
    mediaType: string;
    description?: string | null;
  }>;
  images?: Array<{ url: string; mediaType: string }>;
  questionnaireAnswers?: AgentQuestionAnswer[];
  role: "user" | "assistant" | "tool";
  streaming?: boolean;
  /** Live status from a running sub-agent child loop (e.g. "Reading SOUL.md"). */
  subAgentActivity?: string;
  thinking?: string;
  thinkingStreaming?: boolean;
  tool?: string;
  toolCallId?: string;
  toolInput?: Record<string, unknown>;
  toolInputAccumulatedJson?: string;
  toolResult?: unknown;
  toolStatus?: "running" | "done";
}

export function sessionStorageKey(profileId: string): string {
  return `nakama:session:${profileId}`;
}

export const HISTORY_SESSION_CHANNELS = [
  "web",
  "telegram",
  "whatsapp",
  "discord",
] as const satisfies readonly AgentChannel[];

export function isReadOnlySessionChannel(channel: AgentChannel): boolean {
  return (
    channel === "telegram" || channel === "whatsapp" || channel === "discord"
  );
}

export function formatSessionChannelLabel(channel: AgentChannel): string {
  switch (channel) {
    case "telegram":
      return "Telegram";
    case "whatsapp":
      return "WhatsApp";
    case "discord":
      return "Discord";
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
  messageMeta: SessionMessageMeta[] = []
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
        typeof content === "string"
          ? parseAgentQuestionnaireAnswersMessage(content)
          : null;

      items.push({
        content: text,
        createdAt: meta?.createdAt,
        historyIndex: index,
        id: `history-${index}`,
        role: "user",
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

      for (const block of extractWebSearchBlocksFromProviderContent(
        message.providerContent
      )) {
        if (
          hydratedToolCallIds.has(block.toolCallId) ||
          persistedWebSearchToolIds.has(block.toolCallId)
        ) {
          continue;
        }

        hydratedToolCallIds.add(block.toolCallId);
        items.push({
          content: `${WEB_SEARCH_TOOL_NAME} completed`,
          createdAt: meta?.createdAt,
          historyIndex: index,
          id: block.toolCallId,
          role: "tool",
          tool: WEB_SEARCH_TOOL_NAME,
          toolCallId: block.toolCallId,
          toolInput: block.query ? { query: block.query } : undefined,
          toolResult: block.result,
          toolStatus: "done",
        });
      }

      const thinking = extractThinkingFromAssistantMessage(message);

      items.push({
        content: message.content,
        createdAt: meta?.createdAt,
        historyIndex: index,
        id: `history-${index}`,
        role: "assistant",
        ...(thinking ? { thinking } : {}),
      });
      continue;
    }

    if (message.role === "tool") {
      hydratedToolCallIds.add(message.toolCallId);
      items.push({
        content: `${message.name} completed`,
        createdAt: meta?.createdAt,
        historyIndex: index,
        id: message.toolCallId,
        role: "tool",
        tool: message.name,
        toolCallId: message.toolCallId,
        toolInput: toolInputs.get(message.toolCallId),
        toolResult: parseToolResult(message.content),
        toolStatus: "done",
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
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
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
    tense === "future"
      ? date.getTime() - Date.now()
      : Date.now() - date.getTime();

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
