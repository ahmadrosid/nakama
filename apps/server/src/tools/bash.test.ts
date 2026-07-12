import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { PathGuardError } from "@nakama/core";
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
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "nakama-bash-"));

    const result = await runBash(
      { command: "pwd" },
      { orgId: "org_test", profileId: "profile_test" },
      { workspaceRoot },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(await realpath(workspaceRoot));
    expect(result.timedOut).toBe(false);
  });

  test("supports cwd within the profile workspace", async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "nakama-bash-"));
    const nestedDir = path.join(workspaceRoot, "nested");
    await mkdir(nestedDir, { recursive: true });

    const result = await runBash(
      { command: "pwd", cwd: "nested" },
      { orgId: "org_test", profileId: "profile_test" },
      { workspaceRoot },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(await realpath(nestedDir));
  });

  test("rejects cwd outside the profile workspace", async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "nakama-bash-"));

    await expect(
      runBash(
        { command: "pwd", cwd: "/tmp" },
        { orgId: "org_test", profileId: "profile_test" },
        { workspaceRoot },
      ),
    ).rejects.toBeInstanceOf(PathGuardError);
  });

  test("requires profileId", async () => {
    await expect(runBash({ command: "pwd" }, {})).rejects.toThrow("profileId is required.");
  });

  test("accepts delegation-scale timeouts up to 30 minutes", async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "nakama-bash-"));

    const result = await runBash(
      { command: "echo ok", timeoutMs: 30 * 60_000 },
      { orgId: "org_test", profileId: "profile_test" },
      { workspaceRoot },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("ok");
  });

  test("merges explicit env vars into the spawned shell process", async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "nakama-bash-"));

    const result = await runBash(
      {
        command: "printf '%s' \"$ANTHROPIC_BASE_URL\"",
        env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:4310" },
      },
      { orgId: "org_test", profileId: "profile_test" },
      { workspaceRoot },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("http://127.0.0.1:4310");
  });
});
