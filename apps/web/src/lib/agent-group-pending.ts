import type {
  AgentGroupMessage,
  AgentGroupRun,
  AgentGroupSessionDetail,
} from "@nakama/core/agent-groups";

/** Search params of the side panel; one is open at a time. */
export const PANELS = ["files", "live", "memory", "thread"] as const;

/**
 * `current` with only `panel` open. For `files`, a value other than "1" is the
 * path of the file to show.
 */
export function withPanel(
  current: URLSearchParams,
  panel: (typeof PANELS)[number],
  value: string | null
): URLSearchParams {
  const next = new URLSearchParams(current);

  for (const key of PANELS) {
    next.delete(key);
  }

  if (value !== null) {
    next.set(panel, value);
  }

  return next;
}

/** An agent's full path into a group's shared folder, up to `shared/`. */
const SHARED_DIR_PREFIX =
  /(?:[A-Za-z]:)?[^\s`'"(<[]*\/groups\/[\w-]+\/shared\//g;

const SHARED_FILE = /(?<![\w./-])shared\/([^\s`'"()<>[\]]+)/g;

/** Agents' full paths into the shared folder, as `shared/…`. */
export function shortenSharedPaths(content: string): string {
  return content.replace(SHARED_DIR_PREFIX, "shared/");
}

/** Files in the shared folder a message names, relative to the folder. */
export function sharedFileMentions(content: string): string[] {
  const paths = new Set<string>();

  for (const [, path = ""] of shortenSharedPaths(content).matchAll(
    SHARED_FILE
  )) {
    const file = path.replace(/[.,;:!?*_]+$/, "");

    if (file && !file.endsWith("/")) {
      paths.add(file);
    }
  }

  return [...paths];
}

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
