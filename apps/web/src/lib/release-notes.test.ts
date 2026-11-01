import { expect, test } from "bun:test";
import committed from "../../public/release-notes.json";
import { findReleaseNote, parseReleaseNotes } from "./release-notes";

test("drops entries and changes with the wrong shape", () => {
  const notes = parseReleaseNotes([
    {
      changes: [
        { kind: "new", text: " A " },
        { kind: "oops", text: "B" },
      ],
      version: "1.0.1",
    },
    { version: 2 },
    "junk",
  ]);

  expect(notes).toEqual([
    {
      changes: [{ kind: "new", text: "A" }],
      critical: undefined,
      version: "1.0.1",
    },
  ]);
});

test("keeps the critical reason", () => {
  const [note] = parseReleaseNotes([
    { changes: [], critical: "Fixes a sign-in leak.", version: "1.0.2" },
  ]);

  expect(note?.critical).toBe("Fixes a sign-in leak.");
});

test("finds the note for a version", () => {
  const notes = parseReleaseNotes([{ changes: [], version: "1.0.3" }]);

  expect(findReleaseNote(notes, "1.0.3")?.version).toBe("1.0.3");
  expect(findReleaseNote(notes, "9.9.9")).toBeNull();
});

test("committed notes parse in full and stay in user language", () => {
  const notes = parseReleaseNotes(committed);

  expect(notes).toHaveLength(committed.length);

  for (const [index, note] of notes.entries()) {
    expect(note.changes).toHaveLength(committed[index]?.changes.length ?? -1);

    for (const { text } of note.changes) {
      // No PR prefixes, issue numbers, or file names.
      expect(text).not.toMatch(/^\w+(\([\w-]+\))?!?:|#\d+|\.(tsx?|md|json)\b/);
    }
  }
});
