import { afterEach, expect, test } from "bun:test";
import committed from "../../public/release-notes.json";
import {
  fetchReleaseNotes,
  findReleaseNote,
  releaseNotesSchema,
} from "./release-notes";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function serve(body: string, status = 200) {
  globalThis.fetch = Object.assign(async () => new Response(body, { status }), {
    preconnect: originalFetch.preconnect,
  });
}

test("reads notes and keeps the critical reason", async () => {
  serve(
    JSON.stringify([
      {
        changes: [{ kind: "fixed", text: " A " }],
        critical: "reason",
        version: "1.0.2",
      },
    ])
  );

  const notes = await fetchReleaseNotes();

  expect(notes).toEqual([
    {
      changes: [{ kind: "fixed", text: "A" }],
      critical: "reason",
      version: "1.0.2",
    },
  ]);
});

test("a malformed or missing file gives no notes", async () => {
  serve(
    JSON.stringify([{ changes: [{ kind: "oops", text: "B" }], version: "1" }])
  );
  expect(await fetchReleaseNotes()).toEqual([]);

  serve("", 404);
  expect(await fetchReleaseNotes()).toEqual([]);
});

test("finds the note for a version", () => {
  const notes = [{ changes: [], version: "1.0.3" }];

  expect(findReleaseNote(notes, "1.0.3")?.version).toBe("1.0.3");
  expect(findReleaseNote(notes, "9.9.9")).toBeNull();
});

test("committed notes parse and stay in user language", () => {
  const notes = releaseNotesSchema.parse(committed);

  for (const { text } of notes.flatMap((note) => note.changes)) {
    // No PR prefixes, issue numbers, or file names.
    expect(text).not.toMatch(/^\w+(\([\w-]+\))?!?:|#\d+|\.(tsx?|md|json)\b/);
  }
});
