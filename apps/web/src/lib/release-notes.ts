/**
 * Plain-language notes per release, from `public/release-notes.json`.
 * The release step adds an entry; see AGENTS.md "Releases".
 */

import { z } from "zod";

const releaseChangeSchema = z.object({
  kind: z.enum(["changed", "fixed", "new"]),
  text: z.string().trim().min(1),
});

const releaseNoteSchema = z.object({
  changes: z.array(releaseChangeSchema),
  /** Set only for a build the old page cannot skip: the reason, in one sentence. */
  critical: z.string().trim().min(1).optional(),
  version: z.string().trim().min(1),
});

/** One bad entry rejects the whole file: a half-read file could hide `critical`. */
export const releaseNotesSchema = z.array(releaseNoteSchema);

export type ReleaseNote = z.infer<typeof releaseNoteSchema>;

export const RELEASE_CHANGE_LABELS: Record<
  z.infer<typeof releaseChangeSchema>["kind"],
  string
> = {
  changed: "Changed",
  fixed: "Fixed",
  new: "New",
};

/**
 * Skips the HTTP cache: the file can change on every release. A missing or
 * malformed file gives no notes; a network or server error throws so the
 * caller can try again.
 */
export async function fetchReleaseNotes(): Promise<ReleaseNote[]> {
  const response = await fetch("/release-notes.json", { cache: "no-store" });

  if (response.status === 404) {
    return [];
  }

  if (!response.ok) {
    throw new Error(`release-notes.json: HTTP ${response.status}`);
  }

  const parsed = releaseNotesSchema.safeParse(
    await response.json().catch(() => null)
  );

  return parsed.success ? parsed.data : [];
}

function versionParts(version: string): number[] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version);

  return match ? match.slice(1).map(Number) : null;
}

/** Negative when `a` is older than `b`; null when either is not x.y.z. */
function compareVersions(a: string, b: string): number | null {
  const left = versionParts(a);
  const right = versionParts(b);

  if (!(left && right)) {
    return null;
  }

  for (let index = 0; index < left.length; index++) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);

    if (diff !== 0) {
      return diff;
    }
  }

  return 0;
}

function newestVersion(notes: ReleaseNote[]): string | null {
  let newest: string | null = null;

  for (const { version } of notes) {
    if (newest === null || (compareVersions(version, newest) ?? 0) > 0) {
      newest = version;
    }
  }

  return newest;
}

/**
 * The note for `to`, marked critical when any release after `from` up to `to`
 * is critical, so a skipped security fix still removes Later. Without `to`,
 * the newest note in the file is the target.
 */
export function findReleaseNote(
  notes: ReleaseNote[],
  to: string | null,
  from: string | null = null
): ReleaseNote | null {
  const target = to ?? newestVersion(notes);
  const note = notes.find((entry) => entry.version === target);

  if (!(note && target)) {
    return null;
  }

  if (note.critical || !from) {
    return note;
  }

  const skipped = notes.find((entry) => {
    const afterFrom = compareVersions(entry.version, from);
    const upToTarget = compareVersions(entry.version, target);

    return (
      entry.critical &&
      afterFrom !== null &&
      afterFrom > 0 &&
      upToTarget !== null &&
      upToTarget <= 0
    );
  });

  return skipped ? { ...note, critical: skipped.critical } : note;
}
