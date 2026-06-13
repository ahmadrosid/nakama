import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { PathGuardError } from "@tinyclaw/core";
import { runBash } from "./bash";

describe("bash tool", () => {
  let workspaceRoot = "";

  afterEach(async () => {
    if (workspaceRoot) {
      await rm(workspaceRoot, { recursive: true, force: true });
      workspaceRoot = "";
    }
  });

  test("runs commands in the profile workspace by default", async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-bash-"));

    const result = await runBash(
      { command: "pwd" },
      { profileId: "profile_test" },
      { workspaceRoot },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(await realpath(workspaceRoot));
    expect(result.timedOut).toBe(false);
  });

  test("supports cwd within the profile workspace", async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-bash-"));
    const nestedDir = path.join(workspaceRoot, "nested");
    await mkdir(nestedDir, { recursive: true });

    const result = await runBash(
      { command: "pwd", cwd: "nested" },
      { profileId: "profile_test" },
      { workspaceRoot },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(await realpath(nestedDir));
  });

  test("rejects cwd outside the profile workspace", async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-bash-"));

    await expect(
      runBash(
        { command: "pwd", cwd: "/tmp" },
        { profileId: "profile_test" },
        { workspaceRoot },
      ),
    ).rejects.toBeInstanceOf(PathGuardError);
  });

  test("requires profileId", async () => {
    await expect(runBash({ command: "pwd" }, {})).rejects.toThrow("profileId is required.");
  });
});
