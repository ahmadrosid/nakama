import type {
  AgentGroupMessage,
  AgentGroupRun,
  AgentGroupSessionDetail,
} from "@nakama/core/agent-groups";

/** Shown until the server confirms a reply run, so the page reacts at once. */
export const PENDING_RUN: AgentGroupRun = {
  activity: null,
  speakerProfileId: null,
  stopping: false,
};

/**
 * The user's message as it will look once saved. A negative id never clashes
 * with the server's, which start at 1.
 */
export function pendingMessage(
  content: string,
  files: string[] = []
): AgentGroupMessage {
  return {
    authorProfileId: null,
    content,
    createdAt: new Date().toISOString(),
    ...(files.length > 0 && { files }),
    id: -Date.now(),
    threadReplies: 0,
  };
}

/** The session with the message appended and agents shown as replying. */
export function withPendingMessage(
  detail: AgentGroupSessionDetail,
  content: string,
  files: string[] = []
): AgentGroupSessionDetail {
  return {
    ...detail,
    messages: [...detail.messages, pendingMessage(content, files)],
    run: detail.run ?? PENDING_RUN,
  };
}
