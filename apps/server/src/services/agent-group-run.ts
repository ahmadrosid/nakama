import type { AgentGroupRun } from "@nakama/core/agent-groups";
import {
  appendAgentGroupMessage,
  type StoredGroupSession,
} from "./agent-group-store";
import { type PostedDocument, workspaceOfGroup } from "./agent-group-workspace";

export interface ActiveRun extends AgentGroupRun {
  /** Resolves when the run ends. */
  done: Promise<void>;
  /** Turns that ended in an error, not in a Stop. */
  failures: number;
  groupId: string;
  /** Aborts the hop in progress. */
  hop: AbortController | null;
  hopsLeft: number;
  /** User messages not yet turned into speakers. */
  inbox: string[];
  lastSpeaker: string | null;
  queue: string[];
  /** The replies the run stored, without errors and skip notices. */
  said: { content: string; profileId: string }[];
  steps: string[];
  text: string;
  /** The session title being generated from the first reply. */
  titling: Promise<void> | null;
}

/** An agent answering the user in one thread; at most one per thread. */
export interface ThreadRun extends AgentGroupRun {
  /** The user wrote again while the agent was replying. */
  again: boolean;
  /** Aborts the reply in progress. */
  hop: AbortController | null;
}

/**
 * Saves the user's message with its uploads. When the message cannot be saved,
 * such as on a session deleted meanwhile, its uploads are removed again.
 */
export function appendUserMessage(
  orgId: string,
  session: StoredGroupSession,
  content: string,
  rootId: number | undefined,
  posted: PostedDocument[]
): void {
  const workspace = workspaceOfGroup(orgId, session.groupId);
  const documents = workspace.saveUploads(posted);

  try {
    appendAgentGroupMessage(orgId, session, null, content, rootId, documents);
  } catch (error) {
    workspace.removeUploads(documents.flatMap((d) => d.path ?? d.folder ?? []));
    throw error;
  }
}

/**
 * Drops the queued speakers with the flag, so a message sent after Stop
 * wakes only the agents it mentions.
 */
export function halt(run: ActiveRun): void {
  run.stopping = true;
  run.hop?.abort();
  run.queue.length = 0;
  run.inbox.length = 0;
}

export function enqueue(queue: string[], ids: string[]): void {
  for (const id of ids) {
    if (!queue.includes(id)) {
      queue.push(id);
    }
  }
}

export function threadKey(sessionId: string, rootId: number): string {
  return `${sessionId}:${rootId}`;
}
