import type { SessionSummary } from "@nakama/core/contract";

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
