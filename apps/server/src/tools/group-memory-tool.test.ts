import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "@nakama/core";
import {
  GROUP_MEMORY_CHARS,
  groupWorkspace,
} from "../services/agent-group-workspace";
import { groupMemoryTool } from "./group-memory-tool";

let root = "";

let sharedDir = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "nakama-group-memory-"));
  sharedDir = join(root, "shared");
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

function save(
  input: { entry: string; replaces?: string },
  context: ToolContext = { sharedDir }
) {
  return groupMemoryTool.run(input, context);
}

test("adds, replaces and removes entries, and skips a repeat", async () => {
  expect((await save({ entry: "Genre is noir" })).change).toEqual({
    newEntry: "- Genre is noir",
    oldEntry: null,
  });
  expect((await save({ entry: "- Lead is\nMara" })).change).toEqual({
    newEntry: "- Lead is Mara",
    oldEntry: null,
  });
  expect((await save({ entry: "Genre is noir" })).change).toBeUndefined();
  expect(
    (await save({ entry: "Genre is noir", replaces: "Genre is noir" })).change
  ).toBeUndefined();

  expect(groupWorkspace(sharedDir).memory.read()).toBe("- Genre is noir\n- Lead is Mara");

  expect(
    (await save({ entry: "Genre is sci-fi", replaces: "Genre is noir" })).change
  ).toEqual({ newEntry: "- Genre is sci-fi", oldEntry: "- Genre is noir" });
  expect(
    (await save({ entry: "", replaces: "- Lead is Mara" })).change
  ).toEqual({ newEntry: null, oldEntry: "- Lead is Mara" });

  expect(groupWorkspace(sharedDir).memory.read()).toBe("- Genre is sci-fi");
});

test("works only in a group turn", async () => {
  await expect(save({ entry: "Genre is noir" }, {})).rejects.toThrow();
  expect(groupWorkspace(sharedDir).memory.read()).toBe("");
});

test("an entry to replace that is not there changes nothing", async () => {
  await save({ entry: "Genre is noir" });

  await expect(
    save({ entry: "Genre is sci-fi", replaces: "Genre is horror" })
  ).rejects.toThrow();
  expect(groupWorkspace(sharedDir).memory.read()).toBe("- Genre is noir");
});

test("refuses to grow past the cap, but oversized memory may shrink", async () => {
  const long = "a".repeat(GROUP_MEMORY_CHARS);
  groupWorkspace(sharedDir).memory.replace(`- ${long}`, "");

  await expect(save({ entry: "one more" })).rejects.toThrow();

  await save({ entry: "short", replaces: long });

  expect(groupWorkspace(sharedDir).memory.read()).toBe("- short");
  expect((await save({ entry: "", replaces: "short" })).change).toEqual({
    newEntry: null,
    oldEntry: "- short",
  });
});
