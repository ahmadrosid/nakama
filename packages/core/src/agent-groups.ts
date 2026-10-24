import type { ProfileSummary } from "./contract";
import { slugifyProfileName } from "./profiles";

export interface AgentGroup {
  /** Changes when the custom image changes; `null` when there is none. */
  avatarVersion: string | null;
  /** What the group is for; every agent gets it as context. Empty when unset. */
  brief: string;
  createdAt: string;
  id: string;
  /** The newest main-chat message across the group's sessions. */
  lastMessage: {
    authorProfileId: string | null;
    content: string;
    createdAt: string;
  } | null;
  memberIds: string[];
  name: string;
}

export interface AgentGroupMessage {
  /** `null` for the user who owns the group. */
  authorProfileId: string | null;
  content: string;
  createdAt: string;
  /** Names of the documents the user attached; their text stays on the server. */
  files?: string[];
  id: number;
  /** Images the user pasted, as paths in the group's shared folder. */
  images?: string[];
  /** Replies in the thread opened on this message; always 0 inside a thread. */
  threadReplies: number;
}

export interface AgentGroupRun {
  activity: string | null;
  speakerProfileId: string | null;
  /** What the speaker has done so far this turn, oldest first. */
  steps?: string[];
  stopping: boolean;
  /** The speaker's answer so far this turn. */
  text?: string;
}

/** One conversation in a group; a group holds many, like an agent's chats. */
export interface AgentGroupSession {
  /** True while agents are replying in it. */
  active: boolean;
  createdAt: string;
  groupId: string;
  id: string;
  pinned: boolean;
  title: string;
  updatedAt: string;
}

export interface AgentGroupSessionDetail {
  group: AgentGroup;
  messages: AgentGroupMessage[];
  run: AgentGroupRun | null;
  session: AgentGroupSession;
  /** Messages whose thread has an agent replying right now. */
  threadRunIds: number[];
}

/**
 * A private chat between the user and one agent, opened on that agent's
 * message in a session.
 */
export interface AgentGroupThreadDetail {
  /** The agent's message the thread hangs from, then the replies. */
  messages: AgentGroupMessage[];
  /** The agent the thread is with. */
  profileId: string;
  rootId: number;
  run: AgentGroupRun | null;
}

export interface ListAgentGroupsResponse {
  groups: AgentGroup[];
}

export interface ListAgentGroupSessionsResponse {
  sessions: AgentGroupSession[];
}

/** A session's title: the first line of its first message, kept short. */
export function groupSessionTitle(content: string): string {
  const line = content.trim().split("\n")[0]?.trim() ?? "";

  return line.length > 80 ? `${line.slice(0, 79)}…` : line || "New chat";
}

/** Facts every member of a group reads in every chat of the group. */
export interface AgentGroupMemory {
  content: string;
  /** Characters agents see; the rest is cut. */
  limit: number;
}

/** Agent and group ids the user pinned to the top of the rail, latest first. */
export interface ListRailPinsResponse {
  itemIds: string[];
}

export interface MentionRange {
  end: number;
  handle: string;
  id: string;
  start: number;
}

/** Maps each member's @handle to its profile id, in member order. */
export function memberHandles(
  members: Pick<ProfileSummary, "id" | "name">[]
): Map<string, string> {
  const handles = new Map<string, string>();

  for (const member of members) {
    const base = slugifyProfileName(member.name);
    let handle = base;

    for (let suffix = 2; handles.has(handle); suffix += 1) {
      handle = `${base}-${suffix}`;
    }

    handles.set(handle, member.id);
  }

  return handles;
}

/** Range id of `@all`, which addresses every member at once. */
export const ALL_MEMBERS_ID = "*";

/** Member handles plus `@all`, unless a member is literally named "All". */
function withAll(handles: Map<string, string>): Map<string, string> {
  return handles.has("all")
    ? handles
    : new Map([...handles, ["all", ALL_MEMBERS_ID]]);
}

/** Every member @mention (and `@all`) in `text`, in order. */
export function mentionRanges(
  text: string,
  memberHandleMap: Map<string, string>
): MentionRange[] {
  if (memberHandleMap.size === 0) {
    return [];
  }

  const handles = withAll(memberHandleMap);

  // Handles are slugs ([a-z0-9-]), so they need no escaping. Longest first
  // keeps `@writer-2` from matching as `@writer`; the lookbehind skips emails
  // and URL paths.
  const alternatives = [...handles.keys()]
    .sort((left, right) => right.length - left.length)
    .join("|");

  const pattern = new RegExp(
    String.raw`(?<![\w@/])@(${alternatives})(?![\w-])`,
    "gi"
  );

  return [...text.matchAll(pattern)].flatMap((match) => {
    const handle = match[1]?.toLowerCase() ?? "";
    const id = handles.get(handle);
    const start = match.index ?? 0;

    return id ? [{ end: start + match[0].length, handle, id, start }] : [];
  });
}

/**
 * Profile ids @mentioned in `text`, first mention first, without duplicates.
 * `@all` expands to every member. With `author` set an agent wrote the text:
 * its own handle is skipped and so is `@all`, so agents cannot wake everyone.
 */
export function mentionedMemberIds(
  text: string,
  handles: Map<string, string>,
  author?: string
): string[] {
  const ids: string[] = [];

  for (const { id } of mentionRanges(text, handles)) {
    const expanded =
      id === ALL_MEMBERS_ID ? (author ? [] : [...handles.values()]) : [id];

    for (const memberId of expanded) {
      if (memberId !== author && !ids.includes(memberId)) {
        ids.push(memberId);
      }
    }
  }

  return ids;
}

/**
 * Handles to offer for a half-typed `@query`. A query that already names a
 * member is finished, so Enter sends instead of re-picking it.
 */
export function mentionSuggestions(
  query: string,
  memberHandleMap: Map<string, string>
): string[] {
  const handles = withAll(memberHandleMap);
  const normalized = query.toLowerCase();

  if (handles.has(normalized)) {
    return [];
  }

  // `withAll` appends `all`, so members come first and Enter picks a member.
  return [...handles.keys()].filter((handle) => handle.startsWith(normalized));
}
