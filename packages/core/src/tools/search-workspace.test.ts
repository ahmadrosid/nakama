import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { PathGuardError } from "./builtin";
import { runSearchWorkspace } from "./search-workspace";

describe("search_workspace tool", () => {
  let workspaceRoot = "";

  afterEach(async () => {
    if (workspaceRoot) {
      await rm(workspaceRoot, { recursive: true, force: true });
      workspaceRoot = "";
    }
  });

  test("returns matching snippets with relative file paths", async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-search-"));
    await writeFile(path.join(workspaceRoot, "notes.txt"), "alpha one\nbeta two\n", "utf8");
    await writeFile(path.join(workspaceRoot, "guide.md"), "alpha docs\n", "utf8");

    const result = await runSearchWorkspace(
      { query: "alpha" },
      { profileId: "profile_test" },
      { workspaceRoot },
    );

    expect(result.query).toBe("alpha");
    expect(result.root).toBe(await realpath(workspaceRoot));
    expect(result.matchCount).toBe(2);
    expect(result.matches.some((match) => match.file === "notes.txt")).toBe(true);
    expect(result.matches.some((match) => match.file === "guide.md")).toBe(true);
    expect(result.truncated).toBe(false);
  });

  test("supports fixed-string mode", async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-search-"));
    await writeFile(path.join(workspaceRoot, "literal.txt"), "abc.def\n", "utf8");

    const result = await runSearchWorkspace(
      { query: "abc.def", regex: false },
      { profileId: "profile_test" },
      { workspaceRoot },
    );

    expect(result.matchCount).toBe(1);
    expect(result.matches[0]?.text).toBe("abc.def");
  });

  test("applies glob filters", async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-search-"));
    await writeFile(path.join(workspaceRoot, "one.md"), "needle here\n", "utf8");
    await writeFile(path.join(workspaceRoot, "two.ts"), "needle here\n", "utf8");

    const result = await runSearchWorkspace(
      { query: "needle", glob: "*.md" },
      { profileId: "profile_test" },
      { workspaceRoot },
    );

    expect(result.matchCount).toBe(1);
    expect(result.matches[0]?.file).toBe("one.md");
  });

  test("searches only inside requested subpath", async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-search-"));
    await mkdir(path.join(workspaceRoot, "data"), { recursive: true });
    await writeFile(path.join(workspaceRoot, "data", "inside.txt"), "scoped needle\n", "utf8");
    await writeFile(path.join(workspaceRoot, "outside.txt"), "scoped needle\n", "utf8");

    const result = await runSearchWorkspace(
      { query: "scoped", path: "data" },
      { profileId: "profile_test" },
      { workspaceRoot },
    );

    expect(result.matchCount).toBe(1);
    expect(result.matches[0]?.file).toBe(path.join("data", "inside.txt"));
  });

  test("rejects path traversal outside workspace", async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-search-"));

    await expect(
      runSearchWorkspace(
        { query: "x", path: "../../../etc/passwd" },
        { profileId: "profile_test" },
        { workspaceRoot },
      ),
    ).rejects.toThrow(PathGuardError);
  });

  test("requires profileId", async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-search-"));

    await expect(
      runSearchWorkspace({ query: "x" }, {}, { workspaceRoot }),
    ).rejects.toThrow("profileId is required.");
  });

  test("truncates based on maxResults", async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-search-"));
    const lines = Array.from({ length: 40 }, (_, index) => `hit ${index + 1}`).join("\n");
    await writeFile(path.join(workspaceRoot, "many.txt"), `${lines}\n`, "utf8");

    const result = await runSearchWorkspace(
      { query: "hit", maxResults: 5 },
      { profileId: "profile_test" },
      { workspaceRoot },
    );

    expect(result.matchCount).toBe(5);
    expect(result.truncated).toBe(true);
  });

  test("returns empty results when query has no matches", async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-search-"));
    await writeFile(path.join(workspaceRoot, "plain.txt"), "hello world\n", "utf8");

    const result = await runSearchWorkspace(
      { query: "missing-term" },
      { profileId: "profile_test" },
      { workspaceRoot },
    );

    expect(result.matchCount).toBe(0);
    expect(result.matches).toEqual([]);
    expect(result.truncated).toBe(false);
  });
});
