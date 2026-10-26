import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "@nakama/core";
import { groupWorkspace } from "../services/agent-group-workspace";
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

test("saves a fact to the group's memory", async () => {
  await expect(save({ entry: "Genre is noir" })).resolves.toEqual({
    memory: "- Genre is noir",
  });
  expect(groupWorkspace(sharedDir).memory.read()).toBe("- Genre is noir");
});

test("works only in a group turn", async () => {
  await expect(save({ entry: "Genre is noir" }, {})).rejects.toThrow();
  expect(groupWorkspace(sharedDir).memory.read()).toBe("");
});
