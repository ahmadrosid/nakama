import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type * as acp from "@agentclientprotocol/sdk";
import { isEditInsideFolder } from "./acp-edit-policy";

const folder = mkdtempSync(path.join(os.tmpdir(), "acp-folder-"));

const outside = mkdtempSync(path.join(os.tmpdir(), "acp-outside-"));

mkdirSync(path.join(folder, "notes"));

writeFileSync(path.join(folder, "notes", "a.md"), "x");

function edit(
  paths: string[],
  kind: acp.ToolKind = "edit"
): acp.ToolCallUpdate {
  return {
    kind,
    locations: paths.map((p) => ({ path: p })),
    toolCallId: "t",
  };
}

describe("ACP edit policy", () => {
  test("approves an edit to an existing file inside the folder", () => {
    expect(
      isEditInsideFolder(folder, edit([path.join(folder, "notes", "a.md")]))
    ).toBe(true);
  });

  test("approves creating a new file inside the folder", () => {
    expect(
      isEditInsideFolder(folder, edit([path.join(folder, "new.md")]))
    ).toBe(true);
  });

  test("denies an edit outside the folder", () => {
    expect(isEditInsideFolder(folder, edit([path.join(outside, "x.md")]))).toBe(
      false
    );
  });

  test("denies a path that escapes with ..", () => {
    expect(
      isEditInsideFolder(folder, edit([path.join(folder, "..", "x.md")]))
    ).toBe(false);
  });

  test("denies a symlink that points outside the folder", () => {
    const link = path.join(folder, "link");
    symlinkSync(outside, link);
    expect(isEditInsideFolder(folder, edit([path.join(link, "x.md")]))).toBe(
      false
    );
  });

  test("denies a command, a delete, and an edit with no paths", () => {
    expect(
      isEditInsideFolder(folder, edit([path.join(folder, "a")], "execute"))
    ).toBe(false);
    expect(
      isEditInsideFolder(folder, edit([path.join(folder, "a")], "delete"))
    ).toBe(false);
    expect(isEditInsideFolder(folder, edit([]))).toBe(false);
  });

  test("denies a relative path", () => {
    expect(isEditInsideFolder(folder, edit(["a.md"]))).toBe(false);
  });
});
