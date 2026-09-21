import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { guardFilePath, PathGuardError } from "./paths";

describe("guardFilePath", () => {
  test("allows a new directory beneath a symlinked parent without allowing siblings", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "nakama-new-tools-"));
    try {
      const data = path.join(root, "data");
      const alias = path.join(root, "alias");
      await mkdir(data);
      await symlink(data, alias);
      const toolsDir = path.join(alias, "tools");
      const options = { allowedDirs: [toolsDir], cwd: toolsDir };

      const result = await guardFilePath("echo.js", null, undefined, options);
      expect(result.resolved).toBe(
        path.join(await realpath(data), "tools", "echo.js")
      );
      await expect(
        guardFilePath("../config.ini", null, undefined, options)
      ).rejects.toBeInstanceOf(PathGuardError);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("checks the real cwd and preserves valid directory aliases", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "nakama-cwd-"));
    try {
      const workspace = path.join(root, "workspace");
      const outside = path.join(root, "outside");
      const alias = path.join(root, "alias");
      const nested = path.join(workspace, "nested");
      await mkdir(nested, { recursive: true });
      await mkdir(outside);
      await symlink(nested, alias);
      await symlink(outside, path.join(workspace, "escape"));
      const options = { allowedDirs: [workspace], cwd: workspace };

      for (const cwd of [undefined, "", workspace]) {
        const result = await guardFilePath("notes.md", cwd, undefined, options);
        expect(result.resolved).toBe(
          path.join(await realpath(workspace), "notes.md")
        );
      }
      for (const cwd of [nested, alias, "nested"]) {
        const result = await guardFilePath("notes.md", cwd, undefined, options);
        expect(result.resolved).toBe(
          path.join(await realpath(nested), "notes.md")
        );
      }
      for (const cwd of [outside, path.join(workspace, "escape")]) {
        await expect(
          guardFilePath(
            path.join(workspace, "notes.md"),
            cwd,
            undefined,
            options
          )
        ).rejects.toBeInstanceOf(PathGuardError);
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

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
