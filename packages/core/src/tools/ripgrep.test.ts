import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRipgrepArgs, runRipgrep } from "./ripgrep";

describe("runRipgrep", () => {
  test("a match on one huge line is dropped without buffering the line", async () => {
    const root = await mkdtemp(join(tmpdir(), "nakama-rg-"));

    try {
      await writeFile(
        join(root, "bundle.min.js"),
        `${"a".repeat(5_000_000)}needle${"b".repeat(5_000_000)}\n`
      );

      const result = await runRipgrep(
        buildRipgrepArgs({
          glob: null,
          maxResults: 10,
          query: "needle",
          regex: false,
          searchRoot: root,
        }),
        { maxResults: 10, searchRoot: root, workspaceRoot: root }
      );

      expect(result.truncated).toBe(true);
      expect(JSON.stringify(result.matches).length).toBeLessThan(40_000);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
