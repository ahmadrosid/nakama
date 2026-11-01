import { afterEach, expect, test } from "bun:test";
import committed from "../../public/release-notes.json";
import {
  fetchReleaseNotes,
  findReleaseNote,
  type ReleaseNote,
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

  serve("<html>", 200);
  expect(await fetchReleaseNotes()).toEqual([]);

  serve("", 404);
  expect(await fetchReleaseNotes()).toEqual([]);
});

test("a server error throws so the caller can try again", async () => {
  serve("", 502);

  await expect(fetchReleaseNotes()).rejects.toThrow();
});

const NOTES: ReleaseNote[] = [
  { changes: [], version: "1.0.4" },
  { changes: [], critical: "security", version: "1.0.3" },
  { changes: [], version: "1.0.2" },
];

test("finds the note for a version", () => {
  expect(findReleaseNote(NOTES, "1.0.4")?.version).toBe("1.0.4");
  expect(findReleaseNote(NOTES, "9.9.9")).toBeNull();
});

test("a skipped critical release marks the newer note critical", () => {
  expect(findReleaseNote(NOTES, "1.0.4", "1.0.2")?.critical).toBe("security");
  expect(findReleaseNote(NOTES, "1.0.4", "1.0.3")?.critical).toBeUndefined();
});

test("without the server version, the newest note is used", () => {
  expect(findReleaseNote(NOTES, null)?.version).toBe("1.0.4");
});

test("the committed notes file parses", () => {
  expect(releaseNotesSchema.parse(committed)).toHaveLength(committed.length);
});
