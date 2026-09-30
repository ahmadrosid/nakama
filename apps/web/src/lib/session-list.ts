import {
  type ListSessionsResponse,
  MAX_SESSION_SEARCH_LENGTH,
  type SessionSummary,
} from "@nakama/core/contract";
import type { InfiniteData } from "@tanstack/react-query";

const POLL_MS = 2000;
/**
 * How long after its last update an untitled session is still expected to get a
 * title. The title is generated after the turn returns, so the list has to look
 * again; without a bound, one session whose title generation failed would keep
 * the whole list polling forever.
 */
const TITLE_WAIT_MS = 120_000;

/**
 * How often the session list should look again, or `false` to leave it alone.
 *
 * Three things arrive after the list was last fetched: the generated title, the
 * end of a turn that is still running, and a turn this tab has just started.
 * The last one cannot be read off the list at all, because a turn in a brand new
 * chat begins before that chat has a row, so the caller passes it in. Without
 * it the list would never look again, having nothing outstanding to see.
 */
export function sessionListPollInterval(
  sessions: SessionSummary[] | undefined,
  options: { localTurn?: boolean; now?: number } = {}
): number | false {
  if (options.localTurn) {
    return POLL_MS;
  }

  const now = options.now ?? Date.now();
  const waiting = sessions?.some(
    (session) =>
      session.active ||
      (session.title === null &&
        now - Date.parse(session.updatedAt) < TITLE_WAIT_MS)
  );

  return waiting ? POLL_MS : false;
}

/**
 * The loaded list with `head`, a fresh first page, in place of the first page,
 * or `null` when a chat crossed the end of the first page since the second page
 * was asked for: the pages after it then no longer follow on from it.
 */
export function withFirstPage(
  data: InfiniteData<ListSessionsResponse, string | null>,
  head: ListSessionsResponse
): InfiniteData<ListSessionsResponse, string | null> | null {
  if (data.pages.length > 1 && data.pageParams[1] !== head.nextCursor) {
    return null;
  }
  return { ...data, pages: [head, ...data.pages.slice(1)] };
}

/**
 * The `q` to send for what is in the search field: trimmed, and cut at the
 * length the server accepts, so a paste that got past `maxLength` still
 * searches instead of answering 400.
 */
export function sessionSearchQuery(input: string): string {
  return input.trim().slice(0, MAX_SESSION_SEARCH_LENGTH).trimEnd();
}
