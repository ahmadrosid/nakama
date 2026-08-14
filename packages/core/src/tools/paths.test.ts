import { describe, expect, test } from "bun:test";
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { guardFilePath, PathGuardError } from "./paths";

describe("guardFilePath", () => {
  test("refuses to fall back to process.cwd()", async () => {
    await expect(guardFilePath("SOUL.md", null, undefined, {})).rejects.toThrow(
      PathGuardError
    );
    await expect(guardFilePath("SOUL.md", null, undefined, {})).rejects.toThrow(
      /workspaceRoot is required/
    );
  });

  test("resolves relative paths under an explicit workspace", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "nakama-guard-"));
    const realWorkspace = await realpath(workspaceRoot);
    const guarded = await guardFilePath("SOUL.md", null, undefined, {
      cwd: workspaceRoot,
    });

    expect(guarded.resolved).toBe(path.join(realWorkspace, "SOUL.md"));
    expect(guarded.resolved).not.toBe(path.join(process.cwd(), "SOUL.md"));
  });
});
