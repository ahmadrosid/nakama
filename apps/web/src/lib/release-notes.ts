/**
 * Plain-language notes per release, from `public/release-notes.json`.
 * The release step adds an entry; see AGENTS.md "Releases".
 */

type ReleaseChangeKind = "changed" | "fixed" | "new";

interface ReleaseChange {
  kind: ReleaseChangeKind;
  text: string;
}

export interface ReleaseNote {
  changes: ReleaseChange[];
  /** Set only for a build the old page cannot skip: the reason, in one sentence. */
  critical?: string;
  version: string;
}

export const RELEASE_CHANGE_LABELS: Record<ReleaseChangeKind, string> = {
  changed: "Changed",
  fixed: "Fixed",
  new: "New",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseChange(value: unknown): ReleaseChange | null {
  if (
    !(isRecord(value) && typeof value.text === "string" && value.text.trim())
  ) {
    return null;
  }

  const { kind } = value;

  if (kind !== "changed" && kind !== "fixed" && kind !== "new") {
    return null;
  }

  return { kind, text: value.text.trim() };
}

/** Drops entries that do not match the shape instead of failing the whole file. */
export function parseReleaseNotes(value: unknown): ReleaseNote[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!(isRecord(entry) && typeof entry.version === "string")) {
      return [];
    }

    const changes = Array.isArray(entry.changes)
      ? entry.changes.flatMap((change) => parseChange(change) ?? [])
      : [];

    const critical =
      typeof entry.critical === "string" && entry.critical.trim()
        ? entry.critical.trim()
        : undefined;

    return [{ changes, critical, version: entry.version.trim() }];
  });
}

/** Skips the HTTP cache: the file can change on every release. */
export async function fetchReleaseNotes(): Promise<ReleaseNote[]> {
  const response = await fetch("/release-notes.json", { cache: "no-store" });

  if (!response.ok) {
    return [];
  }

  return parseReleaseNotes(await response.json());
}

export function findReleaseNote(
  notes: ReleaseNote[],
  version: string | null | undefined
): ReleaseNote | null {
  return notes.find((note) => note.version === version) ?? null;
}
