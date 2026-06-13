import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
  PathGuardError,
  runDeleteFile,
  runWriteFile,
  setDefaultFileGuardOptions,
} from "./builtin";

const PROFILE_CONTEXT = { profileId: "profile_test" };
const originalToolsDir = process.env.TINYCLAW_TOOLS_DIR;
const originalConfigDir = process.env.TINYCLAW_CONFIG_DIR;

describe("file builtin tools", () => {
  let tempDir = "";
  let toolsDir = "";

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
    if (toolsDir) {
      await rm(toolsDir, { recursive: true, force: true });
      toolsDir = "";
    }
    if (originalToolsDir === undefined) {
      delete process.env.TINYCLAW_TOOLS_DIR;
    } else {
      process.env.TINYCLAW_TOOLS_DIR = originalToolsDir;
    }
    if (originalConfigDir === undefined) {
      delete process.env.TINYCLAW_CONFIG_DIR;
    } else {
      process.env.TINYCLAW_CONFIG_DIR = originalConfigDir;
    }
    setDefaultFileGuardOptions({});
  });

  test("write_file creates nested files", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-write-"));
    const targetPath = path.join(tempDir, "nested", "hello.txt");

    const result = await runWriteFile(
      { path: targetPath, content: "hello world" },
      PROFILE_CONTEXT,
      { workspaceRoot: tempDir },
    );

    expect(result.path).toBe(await realpath(targetPath));
    expect(result.bytesWritten).toBe(11);
    expect(await readFile(targetPath, "utf8")).toBe("hello world");
  });

  test("write_file resolves relative paths from profile workspace", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-write-"));
    const result = await runWriteFile(
      { path: "notes.txt", content: "relative" },
      PROFILE_CONTEXT,
      { workspaceRoot: tempDir },
    );

    expect(result.path).toBe(path.join(await realpath(tempDir), "notes.txt"));
    expect(await readFile(result.path, "utf8")).toBe("relative");
  });

  test("write_file allows custom tool modules outside profile workspace", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-write-"));
    toolsDir = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-tools-"));
    process.env.TINYCLAW_TOOLS_DIR = toolsDir;

    const targetPath = path.join(toolsDir, "echo.js");
    const result = await runWriteFile(
      { path: targetPath, content: "export async function run() { return null; }" },
      PROFILE_CONTEXT,
      { workspaceRoot: tempDir },
    );

    expect(result.path).toBe(await realpath(targetPath));
    expect(await readFile(targetPath, "utf8")).toContain("export async function run");
  });

  test("delete_file removes a file", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-delete-"));
    const targetPath = path.join(tempDir, "remove-me.txt");
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, "temp", "utf8");
    const resolvedTargetPath = await realpath(targetPath);

    const result = await runDeleteFile(
      { path: targetPath },
      PROFILE_CONTEXT,
      { workspaceRoot: tempDir },
    );

    expect(result).toEqual({ path: resolvedTargetPath, deleted: true });
    await expect(readFile(targetPath, "utf8")).rejects.toThrow();
  });

  test("requires profileId", async () => {
    await expect(runWriteFile({ path: "a.txt", content: "x" }, {})).rejects.toThrow(
      "profileId is required.",
    );
  });

  // -----------------------------------------------------------------------
  // Security tests
  // -----------------------------------------------------------------------

  test("rejects path traversal via ../ escape", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-sec-"));
    const escapePath = path.join(tempDir, "../../../etc/tinyclaw-exploit-test");

    await expect(
      runWriteFile(
        { path: escapePath, content: "ESCAPE" },
        PROFILE_CONTEXT,
        { workspaceRoot: tempDir },
      ),
    ).rejects.toThrow(PathGuardError);
  });

  test("rejects absolute path outside allowed dirs", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-sec-"));

    await expect(
      runWriteFile(
        { path: "/etc/tinyclaw-should-fail", content: "NOPE" },
        PROFILE_CONTEXT,
        { workspaceRoot: tempDir },
      ),
    ).rejects.toThrow(PathGuardError);
  });

  test("rejects home directory expansion outside allowed dirs", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-sec-"));

    await expect(
      runWriteFile(
        { path: "~/.ssh/tinyclaw-test", content: "SSH_KEY" },
        PROFILE_CONTEXT,
        { workspaceRoot: tempDir },
      ),
    ).rejects.toThrow(PathGuardError);
  });

  test("cwd injection falls back to profile workspace", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-sec-"));

    const result = await runWriteFile(
      { path: "safe.txt", content: "OK", cwd: "/etc" },
      PROFILE_CONTEXT,
      { workspaceRoot: tempDir },
    );

    expect(result.path).toStartWith(await realpath(tempDir));
  });

  test("rejects null byte in path", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-sec-"));

    await expect(
      runWriteFile(
        { path: path.join(tempDir, "safe.txt\0.sh"), content: "X" },
        PROFILE_CONTEXT,
        { workspaceRoot: tempDir },
      ),
    ).rejects.toThrow(PathGuardError);
  });

  test("rejects content exceeding max file size", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-sec-"));
    setDefaultFileGuardOptions({ maxFileBytes: 100 });

    await expect(
      runWriteFile(
        { path: path.join(tempDir, "big.txt"), content: "A".repeat(200) },
        PROFILE_CONTEXT,
        { workspaceRoot: tempDir },
      ),
    ).rejects.toThrow(PathGuardError);
  });

  test("delete_file rejects path outside allowed dirs", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-sec-"));

    await expect(
      runDeleteFile(
        { path: "/etc/should-not-delete" },
        PROFILE_CONTEXT,
        { workspaceRoot: tempDir },
      ),
    ).rejects.toThrow(PathGuardError);
  });

  test("allows nested subdirectory writes", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-sec-"));

    const nestedPath = path.join(tempDir, "deep", "nested", "file.txt");
    const result = await runWriteFile(
      { path: nestedPath, content: "deep" },
      PROFILE_CONTEXT,
      { workspaceRoot: tempDir },
    );

    expect(result.path).toBe(await realpath(nestedPath));
    expect(await readFile(nestedPath, "utf8")).toBe("deep");
  });

  test("rejects special filesystem paths", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-sec-"));

    await expect(
      runWriteFile(
        { path: "/dev/null", content: "test" },
        PROFILE_CONTEXT,
        { workspaceRoot: tempDir },
      ),
    ).rejects.toThrow(PathGuardError);
  });
});
