import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readGroupMemory,
  replaceGroupMemory,
  writeGroupMemory,
} from "./agent-group-memory";

let root = "";

let sharedDir = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "nakama-group-memory-"));
  sharedDir = join(root, "shared");
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

test("a save replaces the memory the editor opened", () => {
  writeGroupMemory(sharedDir, "- noir");

  expect(replaceGroupMemory(sharedDir, "- noir\n- Mara", "- noir\n")).toBe(
    "- noir\n- Mara"
  );
});

test("a save over a fact an agent added since is refused and keeps it", () => {
  writeGroupMemory(sharedDir, "- noir\n- Mara");

  expect(() => replaceGroupMemory(sharedDir, "", "- noir")).toThrow(
    expect.objectContaining({ status: 409 })
  );
  expect(readGroupMemory(sharedDir)).toBe("- noir\n- Mara");
});
