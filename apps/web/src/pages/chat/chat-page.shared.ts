import type { AgentChannel, SetupChecklistItem } from "@nakama/core/contract";
import { parseUserContext } from "@nakama/core/user-context";
import type { ChatListItem, FailedChatTurn } from "@/lib/chat-history";
import { createClientId } from "@/lib/client-id";

/**
 * Keys the welcome copy so React remounts it when cognito is toggled, which is
 * what replays the entrance animation. Without the remount the copy would swap
 * in silence and the user would not notice the mode changed under them.
 */
export function welcomeAnimationKey(cognito: boolean): string {
  return cognito ? "cognito" : "greeting";
}

/**
 * The toggle only does anything before a conversation starts, because flipping
 * it resets the chat. Once an ordinary chat is under way it is a control that
 * cannot be used, so it goes away. An active cognito chat keeps it, otherwise
 * there would be no way to see the mode or leave it.
 */
export function shouldShowCognitoControl(
  cognito: boolean,
  isEmptyState: boolean
): boolean {
  return cognito || isEmptyState;
}

/**
 * A new user lands on an empty chat with no idea what to ask. The goal prompt
 * shows only then: someone who can chat, has no web chat yet, and has not
 * said what they want help with. A saved goal or a first chat ends it.
 */
export function shouldShowGoalPrompt({
  orgRole,
  sessions,
  userContext,
}: {
  orgRole: string | undefined;
  sessions: readonly { channel: AgentChannel }[];
  userContext: string | null | undefined;
}): boolean {
  if (orgRole === "viewer") {
    return false;
  }

  if (sessions.some((session) => session.channel === "web")) {
    return false;
  }

  return !parseUserContext(userContext).answers.help?.trim();
}

const SETUP_CHECKLIST_STORAGE_PREFIX = "nakama:setup-checklist:";

/** The checklist a user got from their goal, and what they did with it. */
export interface StoredSetupChecklist {
  /** Keys the user finished where the app cannot see the result itself. */
  done: string[];
  goal: string | null;
  items: SetupChecklistItem[];
  skipped: string[];
}

type SetupItemStatus = "done" | "open" | "skipped";

export interface SetupChecklistRow {
  item: SetupChecklistItem;
  key: string;
  status: SetupItemStatus;
}

function setupItemKey(item: SetupChecklistItem): string {
  switch (item.kind) {
    case "connect_toolkit":
      return `toolkit:${item.toolkitSlug}`;
    case "enable_skill":
      return `skill:${item.skillId}`;
    case "write_context":
      return `context:${item.scope}`;
    default:
      throw new Error("Unknown setup checklist item.");
  }
}

function setupChecklistStorageKey(orgId: string, userId: string): string {
  return `${SETUP_CHECKLIST_STORAGE_PREFIX}${orgId}:${userId}`;
}

/** A stored item as it may come back from storage: any field can be wrong. */
interface UncheckedSetupItem {
  kind?: string;
  scope?: string;
  skillId?: string;
  title?: string;
  toolkitSlug?: string;
}

/** Stored state before checks; each field is verified in readSetupChecklist. */
interface UncheckedSetupChecklist {
  done?: string[];
  goal?: string | null;
  items?: UncheckedSetupItem[];
  skipped?: string[];
}

function isText(value: string | undefined): value is string {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- This guard validates decoded external data before the caller uses the domain value.
  return typeof value === "string";
}

function toSetupChecklistItem(
  item: UncheckedSetupItem | null
): SetupChecklistItem | null {
  if (!(item && isText(item.title))) {
    return null;
  }

  if (item.kind === "connect_toolkit" && isText(item.toolkitSlug)) {
    return {
      kind: item.kind,
      title: item.title,
      toolkitSlug: item.toolkitSlug,
    };
  }

  if (item.kind === "enable_skill" && isText(item.skillId)) {
    return { kind: item.kind, skillId: item.skillId, title: item.title };
  }

  if (item.kind === "write_context" && item.scope === "org") {
    return { kind: item.kind, scope: item.scope, title: item.title };
  }

  return null;
}

function storedStrings(list: string[] | undefined): string[] {
  return Array.isArray(list) ? list.filter(isText) : [];
}

/**
 * Per browser on purpose: the checklist is a first-run aid, so losing it on
 * another device costs a re-ask at most. A bad or missing value reads as none.
 */
export function readSetupChecklist(
  orgId: string,
  userId: string
): StoredSetupChecklist | null {
  try {
    const raw = localStorage.getItem(setupChecklistStorageKey(orgId, userId));

    if (!raw) {
      return null;
    }

    // SAFETY: JSON.parse returns the values checked by the validation that follows.
    const parsed = JSON.parse(raw) as UncheckedSetupChecklist;

    if (!Array.isArray(parsed.items)) {
      return null;
    }

    return {
      done: storedStrings(parsed.done),
      goal: isText(parsed.goal ?? undefined) ? (parsed.goal ?? null) : null,
      items: parsed.items
        .map(toSetupChecklistItem)
        .filter((item) => item !== null),
      skipped: storedStrings(parsed.skipped),
    };
  } catch {
    return null;
  }
}

export function writeSetupChecklist(
  orgId: string,
  userId: string,
  value: StoredSetupChecklist
): void {
  try {
    localStorage.setItem(
      setupChecklistStorageKey(orgId, userId),
      JSON.stringify(value)
    );
  } catch {
    // Storage can be full or blocked; the checklist still works for this visit.
  }
}

/**
 * Status per item from what the app already loads, so a return visit costs no
 * model call: a connected toolkit, a skill the agent has, or org memory with
 * a fact. Members cannot edit org memory, so their business context counts as
 * done once they save About you.
 */
export function setupChecklistRows(
  stored: StoredSetupChecklist,
  facts: {
    assignedSkillIds: readonly string[];
    connectedToolkits: readonly string[];
    orgHasFacts: boolean;
  }
): SetupChecklistRow[] {
  const finished = new Set(stored.done);
  const skipped = new Set(stored.skipped);
  const assigned = new Set(facts.assignedSkillIds);
  const connected = new Set(facts.connectedToolkits);

  return stored.items.map((item) => {
    const key = setupItemKey(item);

    const done =
      finished.has(key) ||
      (item.kind === "connect_toolkit" && connected.has(item.toolkitSlug)) ||
      (item.kind === "enable_skill" && assigned.has(item.skillId)) ||
      (item.kind === "write_context" && facts.orgHasFacts);

    return {
      item,
      key,
      status: done ? "done" : skipped.has(key) ? "skipped" : "open",
    };
  });
}

/** Org memory starts as headings only; a bullet is the first real fact. */
export function orgMemoryHasFacts(content: string | null | undefined): boolean {
  return (content ?? "").split("\n").some((line) => /^\s*[-*]\s+\S/.test(line));
}

export function findRetryPrompt(
  messages: ChatListItem[],
  assistantMessage: ChatListItem
): ChatListItem | null {
  if (assistantMessage.historyIndex === undefined) {
    return null;
  }

  return (
    messages.findLast(
      (message) =>
        message.role === "user" &&
        message.historyIndex !== undefined &&
        message.historyIndex < assistantMessage.historyIndex!
    ) ?? null
  );
}

function findRetryCheckpoint(
  messages: ChatListItem[],
  promptMessage: ChatListItem
): ChatListItem | null {
  if (promptMessage.historyIndex === undefined) {
    return null;
  }

  return (
    messages.findLast(
      (message) =>
        message.historyIndex !== undefined &&
        message.historyIndex < promptMessage.historyIndex!
    ) ?? null
  );
}

/** Where to branch a session when resending a prompt, and what the branch keeps. */
export interface PromptBranchPlan {
  /** Messages already in history that the branch starts with. */
  initialMessages: ChatListItem[];
  /** History index the branch is cut at. */
  messageIndex: number;
}

/**
 * Plan for resending `prompt`: branch at the row before it and carry everything
 * up to that row. Null when nothing precedes the prompt in history, which means
 * a fresh session rather than a branch.
 */
export function planPromptBranch(
  messages: ChatListItem[],
  prompt: ChatListItem
): PromptBranchPlan | null {
  const checkpoint = findRetryCheckpoint(messages, prompt);
  const messageIndex = checkpoint?.historyIndex;

  if (messageIndex === undefined) {
    return null;
  }

  return {
    initialMessages: messages.filter(
      (item) =>
        item.historyIndex !== undefined && item.historyIndex <= messageIndex
    ),
    messageIndex,
  };
}

/**
 * The text an edit should resend, or null when the edit changes nothing and the
 * flow should stop before branching.
 */
export function editedPromptText(
  message: ChatListItem,
  text: string
): string | null {
  const next = text.trim();

  if (!next || next === message.content.trim()) {
    return null;
  }

  return next;
}

function buildFailedAssistantMessage(error: string): ChatListItem {
  return {
    content: error,
    failed: true,
    id: createClientId(),
    role: "assistant",
  };
}

/** Convert a live streaming turn into a persistent failed marker. */
export function markStreamingTurnFailed(
  messages: ChatListItem[],
  error: string
): ChatListItem[] {
  const next = messages.map((message) => {
    if (message.role === "tool" && message.toolStatus === "running") {
      return {
        ...message,
        artifactStreaming: false,
        content: `${message.tool} stopped`,
        toolStatus: "done" as const,
      };
    }

    return message;
  });

  for (let index = next.length - 1; index >= 0; index -= 1) {
    const message = next[index];

    if (message?.role === "assistant" && message.streaming) {
      next[index] = {
        ...message,
        content: error,
        failed: true,
        streaming: false,
        thinkingStreaming: false,
      };

      return next;
    }
  }

  const last = next.at(-1);

  if (last?.role === "user") {
    return [...next, buildFailedAssistantMessage(error)];
  }

  return next;
}

/** Re-attach a stored failed turn after reload (server history rolls failed sends back). */
export function appendFailedTurnIfNeeded(
  messages: ChatListItem[],
  failed: FailedChatTurn
): ChatListItem[] {
  if (messages.some((message) => message.failed)) {
    return messages;
  }

  const last = messages.at(-1);

  if (last?.role === "user" && last.content === failed.text) {
    return [...messages, buildFailedAssistantMessage(failed.error)];
  }

  return [
    ...messages,
    {
      content: failed.text,
      id: createClientId(),
      role: "user",
    },
    buildFailedAssistantMessage(failed.error),
  ];
}

export function findFailedRetryPrompt(
  messages: ChatListItem[],
  failedMessage: ChatListItem
): ChatListItem | null {
  const failedIndex = messages.findIndex(
    (message) => message.id === failedMessage.id
  );

  if (failedIndex < 0) {
    return null;
  }

  return (
    messages
      .slice(0, failedIndex)
      .findLast((message) => message.role === "user") ?? null
  );
}

/** Drop the failed assistant + its optimistic user prompt before re-sending. */
export function messagesWithoutFailedTurn(
  messages: ChatListItem[],
  failedMessage: ChatListItem
): ChatListItem[] {
  const failedIndex = messages.findIndex(
    (message) => message.id === failedMessage.id
  );

  if (failedIndex < 0) {
    return messages;
  }

  let start = failedIndex;
  const previous = messages[failedIndex - 1];

  if (previous?.role === "user" && previous.historyIndex === undefined) {
    start = failedIndex - 1;
  }

  return [...messages.slice(0, start), ...messages.slice(failedIndex + 1)];
}

/**
 * Wall-clock stamp for post-turn polling, bumped by 1ms when two turns finish
 * in the same millisecond so consumers never see a duplicate key.
 */
export function nextSuccessfulTurnAt(
  previous: number | null,
  now = Date.now()
): number {
  return previous != null && now <= previous ? previous + 1 : now;
}

/**
 * Give up the page's hold on a chat stream when the user opens another chat.
 *
 * A send stream is detached, never aborted: the POST behind it is what keeps
 * the server turn alive, so aborting it on a chat switch cancels a turn the
 * user still wants. A subscribe stream only mirrors a turn someone else owns,
 * so it is safe to abort.
 */
export function releaseChatStream(stream: {
  abort: AbortController | null;
  detach: (() => void) | null;
}): "detached" | "aborted" | "idle" {
  if (stream.detach) {
    stream.detach();

    return "detached";
  }

  if (stream.abort) {
    stream.abort.abort();

    return "aborted";
  }

  return "idle";
}
