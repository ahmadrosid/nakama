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

/** Skips the HTTP cache: the file can change on every release. */
export async function fetchReleaseNotes(): Promise<ReleaseNote[]> {
  const response = await fetch("/release-notes.json", { cache: "no-store" });

  if (!response.ok) {
    return [];
  }

  const parsed = releaseNotesSchema.safeParse(await response.json());

  return parsed.success ? parsed.data : [];
}

export function findReleaseNote(
  notes: ReleaseNote[],
  version: string | null | undefined
): ReleaseNote | null {
  return notes.find((note) => note.version === version) ?? null;
}
