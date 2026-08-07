import { chmod, mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
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

  test("summarizes Cursor stream-json for coding-agent runs and saves a full log", async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "nakama-bash-"));
    const agentPath = path.join(workspaceRoot, "agent");
    const stream = [
      '{"type":"system","subtype":"init","model":"composer-2","cwd":"/tmp/repo"}',
      ...Array.from({ length: 80 }, (_, i) =>
        JSON.stringify({
          type: "tool_call",
          subtype: "started",
          tool_call: { readToolCall: { args: { path: `pad-${i}.ts` } } },
        }),
      ),
      '{"type":"assistant","message":{"content":[{"type":"text","text":"Patched the flaky test."}]}}',
      '{"type":"result","subtype":"success","result":"All checks passed.","duration_ms":42}',
      "",
    ].join("\n");

    await writeFile(
      agentPath,
      `#!/bin/bash\ncat <<'EOF'\n${stream}EOF\n`,
      "utf8",
    );
    await chmod(agentPath, 0o755);

    const result = await runBash(
      {
        command: "./agent -p 'fix the flaky test' --output-format stream-json --yolo",
        codingAgent: true,
      },
      { orgId: "org_test", profileId: "profile_test" },
      { workspaceRoot },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("# Cursor Agent result");
    expect(result.stdout).toContain("Patched the flaky test.");
    expect(result.stdout).toContain("All checks passed.");
    expect(result.stdout).toContain("Full coding-agent log: artifacts/coding-agent-runs/");
    expect(result.stdout).not.toContain("...[truncated]\n{\"type\":\"system\"");

    const logDir = path.join(workspaceRoot, "artifacts", "coding-agent-runs");
    const logs = await readdir(logDir);
    expect(logs.length).toBe(1);
    const logBody = await readFile(path.join(logDir, logs[0]!), "utf8");
    expect(logBody).toContain('"type":"result"');
    expect(logBody).toContain("All checks passed.");
  });

  test("keep-tails long plain coding-agent stdout instead of head-truncating", async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "nakama-bash-"));
    const agentPath = path.join(workspaceRoot, "agent");
    const body = `${"n".repeat(40_000)}TAIL_MARKER_OK`;
    await writeFile(agentPath, `#!/bin/bash\ncat <<'EOF'\n${body}EOF\n`, "utf8");
    await chmod(agentPath, 0o755);

    const result = await runBash(
      {
        command: "./agent -p 'hello' --output-format text --yolo",
        codingAgent: true,
      },
      { orgId: "org_test", profileId: "profile_test" },
      { workspaceRoot },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("TAIL_MARKER_OK");
    expect(result.stdout).toContain("Full coding-agent log:");
  });
});
