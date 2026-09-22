import { afterEach, describe, expect, test } from "bun:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getProfileSoulDir, PathGuardError } from "@nakama/core";
import { runBash } from "./bash";

async function waitForPositivePid(pidPath: string): Promise<number> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const pid = Number((await readFile(pidPath, "utf8")).trim());
      if (Number.isInteger(pid) && pid > 0) {
        return pid;
      }
    } catch {
      // The shell has not created the PID file yet.
    }
    await Bun.sleep(10);
  }
  return 0;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("bash tool", () => {
  let workspaceRoot = "";

  afterEach(async () => {
    if (workspaceRoot) {
      await rm(workspaceRoot, { force: true, recursive: true });
      workspaceRoot = "";
    }
  });

  for (const mode of ["abort", "timeout"] as const) {
    test(`${mode} stops shell descendants and finishes the tool`, async () => {
      workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "nakama-bash-"));
      const controller = new AbortController();
      const pending = runBash(
        {
          command: "sleep 30 & echo $! > child.pid; wait",
          timeoutMs: mode === "timeout" ? 500 : 30_000,
        },
        {
          orgId: "org_test",
          profileId: "profile_test",
          signal: controller.signal,
        },
        { backend: "host", workspaceRoot }
      ).catch((error: unknown) => error);
      const pid = await waitForPositivePid(
        path.join(workspaceRoot, "child.pid")
      );
      try {
        expect(pid).toBeGreaterThan(0);
        if (mode === "abort") {
          controller.abort();
        }
        const result = await Promise.race([
          pending,
          Bun.sleep(2000).then(() => "hung"),
        ]);
        expect(result).not.toBe("hung");
        if (mode === "abort") {
          expect(result).toMatchObject({ name: "AbortError" });
        } else {
          expect(result).toMatchObject({ timedOut: true });
        }
        // Reaping descendants can lag the shell's close event slightly.
        for (let i = 0; i < 50 && isProcessAlive(pid); i++) {
          await Bun.sleep(10);
        }
        expect(isProcessAlive(pid)).toBe(false);
      } finally {
        if (pid > 0 && isProcessAlive(pid)) {
          process.kill(pid, "SIGKILL");
        }
        controller.abort();
        await pending;
      }
    });
  }

  test("returns after shell exit when a quiet descendant holds the pipes", async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "nakama-bash-"));
    const pending = runBash(
      { command: "sleep 30 & echo $! > child.pid; echo done; exit 0" },
      { orgId: "org_test", profileId: "profile_test" },
      { backend: "host", workspaceRoot }
    );
    const pid = await waitForPositivePid(path.join(workspaceRoot, "child.pid"));
    try {
      expect(pid).toBeGreaterThan(0);
      const result = await Promise.race([
        pending,
        Bun.sleep(2000).then(() => "hung"),
      ]);
      expect(result).toMatchObject({
        exitCode: 0,
        stdout: "done\n",
        timedOut: false,
      });
    } finally {
      if (pid > 0 && isProcessAlive(pid)) {
        process.kill(pid, "SIGKILL");
      }
      await pending;
    }
  });

  test("drains active descendant output after the shell exits", async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "nakama-bash-"));
    const result = await runBash(
      {
        command:
          '(for i in 1 2 3 4 5 6 7 8; do echo "$i"; sleep 0.04; done) & exit 0',
      },
      { orgId: "org_test", profileId: "profile_test" },
      { backend: "host", workspaceRoot }
    );
    expect(result).toMatchObject({
      exitCode: 0,
      stdout: "1\n2\n3\n4\n5\n6\n7\n8\n",
      timedOut: false,
    });
  });

  test("does not spawn a command after cancellation", async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "nakama-bash-"));
    const controller = new AbortController();
    controller.abort();
    await expect(
      runBash(
        { command: "echo started > marker" },
        {
          orgId: "org_test",
          profileId: "profile_test",
          signal: controller.signal,
        },
        { backend: "host", workspaceRoot }
      )
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(await readdir(workspaceRoot)).toEqual([]);
  });

  test("kills the shell when the turn is cancelled", async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "nakama-bash-"));

    const controller = new AbortController();
    const startedAt = Date.now();
    // 30s beats any plausible test runtime, so finishing fast can only mean the
    // abort killed it rather than the command completing on its own.
    const pending = runBash(
      { command: "sleep 30" },
      {
        orgId: "org_test",
        profileId: "profile_test",
        signal: controller.signal,
      },
      { workspaceRoot }
    );

    setTimeout(() => controller.abort(), 50);

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(Date.now() - startedAt).toBeLessThan(5000);
  });

  test("force kills a shell that traps SIGTERM after cancellation", async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "nakama-bash-"));
    const pidPath = path.join(workspaceRoot, "trapped.pid");
    const controller = new AbortController();
    const pending = runBash(
      {
        command:
          "trap '' TERM; echo $$ > trapped.pid; while :; do sleep 1; done",
      },
      {
        orgId: "org_test",
        profileId: "profile_test",
        signal: controller.signal,
      },
      { workspaceRoot }
    );

    const childPid = await waitForPositivePid(pidPath);

    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(childPid).toBeGreaterThan(0);

    let survivedAbort = true;
    const forceKillDeadline = Date.now() + 6500;
    while (Date.now() < forceKillDeadline) {
      if (!isProcessAlive(childPid)) {
        survivedAbort = false;
        break;
      }
      await Bun.sleep(25);
    }

    if (survivedAbort) {
      process.kill(childPid, "SIGKILL");
    }
    expect(survivedAbort).toBe(false);
  }, 10_000);

  test("runs commands in the profile workspace by default", async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "nakama-bash-"));

    const result = await runBash(
      { command: "pwd" },
      { orgId: "org_test", profileId: "profile_test" },
      { workspaceRoot }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(await realpath(workspaceRoot));
    expect(result.timedOut).toBe(false);
  });

  test("ordinary commands resolve the profile workspace without an override", async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "nakama-bash-"));
    const previousConfigDir = process.env.NAKAMA_CONFIG_DIR;
    process.env.NAKAMA_CONFIG_DIR = workspaceRoot;

    try {
      const profileWorkspace = getProfileSoulDir("org_test", "profile_test");
      await mkdir(profileWorkspace, { recursive: true });

      for (const codingWorkspaceRoot of [undefined, workspaceRoot]) {
        for (const cwd of [undefined, ".", profileWorkspace]) {
          const result = await runBash(
            { command: "pwd", cwd },
            {
              codingWorkspaceRoot,
              orgId: "org_test",
              profileId: "profile_test",
            },
            { backend: "host" }
          );
          expect(result.exitCode).toBe(0);
          expect(result.stdout.trim()).toBe(await realpath(profileWorkspace));
        }
      }
    } finally {
      if (previousConfigDir === undefined) {
        delete process.env.NAKAMA_CONFIG_DIR;
      } else {
        process.env.NAKAMA_CONFIG_DIR = previousConfigDir;
      }
    }
  });

  test("ordinary commands use the active user workspace from context", async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "nakama-bash-user-"));
    const result = await runBash(
      { command: "pwd" },
      {
        orgId: "org_test",
        profileId: "profile_test",
        workspaceRoot,
      },
      { backend: "host" }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(await realpath(workspaceRoot));
  });

  test("CLI commands use the launch directory without coding-agent mode", async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "nakama-bash-"));
    const context = {
      channel: "cli" as const,
      codingWorkspaceRoot: workspaceRoot,
      orgId: "org_test",
      profileId: "profile_test",
    };
    const nestedDir = path.join(workspaceRoot, "nested");
    await mkdir(nestedDir);

    for (const cwd of [undefined, ".", workspaceRoot, "nested"]) {
      const result = await runBash({ command: "pwd", cwd }, context, {
        backend: "host",
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe(
        await realpath(cwd === "nested" ? nestedDir : workspaceRoot)
      );
    }

    await expect(
      runBash({ command: "pwd", cwd: ".." }, context, { backend: "host" })
    ).rejects.toBeInstanceOf(PathGuardError);
  });

  test("coding-agent workspace selection respects explicit overrides", async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "nakama-bash-"));
    const codingWorkspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "nakama-coding-workspace-")
    );

    const codingResult = await runBash(
      { codingAgent: true, command: "pwd" },
      {
        codingWorkspaceRoot,
        orgId: "org_test",
        profileId: "profile_test",
      }
    );
    const ordinaryResult = await runBash(
      { command: "pwd" },
      {
        codingWorkspaceRoot,
        orgId: "org_test",
        profileId: "profile_test",
      },
      { workspaceRoot }
    );

    expect(codingResult.stdout.trim().split("\n")[0]).toBe(
      await realpath(codingWorkspaceRoot)
    );
    expect(ordinaryResult.stdout.trim()).toBe(await realpath(workspaceRoot));
    await rm(codingWorkspaceRoot, { force: true, recursive: true });
  });

  test("supports cwd within the profile workspace", async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "nakama-bash-"));
    const nestedDir = path.join(workspaceRoot, "nested");
    await mkdir(nestedDir, { recursive: true });

    const result = await runBash(
      { command: "pwd", cwd: "nested" },
      { orgId: "org_test", profileId: "profile_test" },
      { workspaceRoot }
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
        { workspaceRoot }
      )
    ).rejects.toBeInstanceOf(PathGuardError);
  });

  test("requires profileId", async () => {
    await expect(runBash({ command: "pwd" }, {})).rejects.toThrow(
      "profileId is required."
    );
  });

  test("accepts delegation-scale timeouts up to 30 minutes", async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "nakama-bash-"));

    const result = await runBash(
      { command: "echo ok", timeoutMs: 30 * 60_000 },
      { orgId: "org_test", profileId: "profile_test" },
      { workspaceRoot }
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
      { workspaceRoot }
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
          subtype: "started",
          tool_call: { readToolCall: { args: { path: `pad-${i}.ts` } } },
          type: "tool_call",
        })
      ),
      '{"type":"assistant","message":{"content":[{"type":"text","text":"Patched the flaky test."}]}}',
      '{"type":"result","subtype":"success","result":"All checks passed.","duration_ms":42}',
      "",
    ].join("\n");

    await writeFile(
      agentPath,
      `#!/bin/bash\ncat <<'EOF'\n${stream}EOF\n`,
      "utf8"
    );
    await chmod(agentPath, 0o755);

    const result = await runBash(
      {
        codingAgent: true,
        command:
          "./agent -p 'fix the flaky test' --output-format stream-json --yolo",
      },
      { orgId: "org_test", profileId: "profile_test" },
      { workspaceRoot }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("# Cursor Agent result");
    expect(result.stdout).toContain("Patched the flaky test.");
    expect(result.stdout).toContain("All checks passed.");
    expect(result.stdout).toContain(
      "Full coding-agent log: artifacts/coding-agent-runs/"
    );
    expect(result.stdout).not.toContain('...[truncated]\n{"type":"system"');

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
    await writeFile(
      agentPath,
      `#!/bin/bash\ncat <<'EOF'\n${body}EOF\n`,
      "utf8"
    );
    await chmod(agentPath, 0o755);

    const result = await runBash(
      {
        codingAgent: true,
        command: "./agent -p 'hello' --output-format text --yolo",
      },
      { orgId: "org_test", profileId: "profile_test" },
      { workspaceRoot }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("TAIL_MARKER_OK");
    expect(result.stdout).toContain("Full coding-agent log:");
  });

  // `/bin/bash -lc` sources BASH_ENV before it runs the command, so an env key
  // the model chose is arbitrary code execution unless it is stripped.
  test("drops env keys that hijack the shell before the command runs", async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "nakama-bash-"));
    const hijackPath = path.join(workspaceRoot, "hijack.sh");
    await writeFile(hijackPath, "echo HIJACKED\n", "utf8");

    const result = await runBash(
      {
        command: 'echo "keep=$KEEP_ME preload=$LD_PRELOAD node=$NODE_OPTIONS"',
        env: {
          BASH_ENV: hijackPath,
          KEEP_ME: "kept",
          LD_PRELOAD: "/tmp/evil.so",
          NODE_OPTIONS: "--require=/tmp/evil.js",
        },
      },
      { orgId: "org_test", profileId: "profile_test" },
      { workspaceRoot }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("HIJACKED");
    expect(result.stdout.trim()).toBe("keep=kept preload= node=");
  });

  test("prunes coding-agent logs to the newest 10 and leaves other artifacts", async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "nakama-bash-"));
    const logDir = path.join(workspaceRoot, "artifacts", "coding-agent-runs");
    await mkdir(logDir, { recursive: true });
    await writeFile(path.join(logDir, "keep-me.txt"), "user file", "utf8");

    const now = Date.now();
    for (let i = 0; i < 15; i++) {
      const name = `old-${String(i).padStart(2, "0")}.log`;
      const filePath = path.join(logDir, name);
      await writeFile(filePath, `old ${i}`, "utf8");
      const stamp = new Date(now - (15 - i) * 60_000);
      await utimes(filePath, stamp, stamp);
    }

    const agentPath = path.join(workspaceRoot, "agent");
    await writeFile(agentPath, "#!/bin/bash\necho done\n", "utf8");
    await chmod(agentPath, 0o755);

    const result = await runBash(
      {
        codingAgent: true,
        command: "./agent -p 'hello' --output-format text --yolo",
      },
      { orgId: "org_test", profileId: "profile_test" },
      { workspaceRoot }
    );

    expect(result.exitCode).toBe(0);
    const remaining = await readdir(logDir);
    const logs = remaining.filter((name) => name.endsWith(".log"));
    expect(logs).toHaveLength(10);
    expect(remaining).toContain("keep-me.txt");
    expect(remaining).not.toContain("old-00.log");
    expect(logs.some((name) => !name.startsWith("old-"))).toBe(true);
  });
});
