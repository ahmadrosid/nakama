import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "@nakama/core";
import {
  GROUP_MEMORY_CHARS,
  readGroupMemory,
  writeGroupMemory,
} from "../services/agent-group-memory";
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
  await save({ entry: "Genre is noir" });
  await save({ entry: "- Lead is\nMara" });
  await save({ entry: "Genre is noir" });

  expect(readGroupMemory(sharedDir)).toBe("- Genre is noir\n- Lead is Mara");

  await save({ entry: "Genre is sci-fi", replaces: "Genre is noir" });
  await save({ entry: "", replaces: "- Lead is Mara" });

  expect(readGroupMemory(sharedDir)).toBe("- Genre is sci-fi");
});

test("works only in a group turn", async () => {
  await expect(save({ entry: "Genre is noir" }, {})).rejects.toThrow();
  expect(readGroupMemory(sharedDir)).toBe("");
});

test("an entry to replace that is not there changes nothing", async () => {
  await save({ entry: "Genre is noir" });

  await expect(
    save({ entry: "Genre is sci-fi", replaces: "Genre is horror" })
  ).rejects.toThrow();
  expect(readGroupMemory(sharedDir)).toBe("- Genre is noir");
});

test("refuses to grow past the cap, but oversized memory may shrink", async () => {
  const long = "a".repeat(GROUP_MEMORY_CHARS);
  writeGroupMemory(sharedDir, `- ${long}`);

  await expect(save({ entry: "one more" })).rejects.toThrow();

  await save({ entry: "short", replaces: long });

  expect(readGroupMemory(sharedDir)).toBe("- short");
});
