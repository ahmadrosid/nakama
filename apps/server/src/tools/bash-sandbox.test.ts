import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PathGuardError } from "@nakama/core";
import { resetBashSandboxManagerForTests, runBash } from "./bash";
import {
  resolveBashBackend,
  resolveBashSandboxImage,
  resolveBashSandboxNetwork,
} from "./bash-config";
import { buildBashSandboxEnv } from "./bash-sandbox-env";
import {
  type BashSandboxEnsureArgs,
  type BashSandboxExecArgs,
  type BashSandboxRuntime,
  ProfileSandboxManager,
  profileSandboxName,
  toGuestCwd,
} from "./profile-sandbox-manager";

describe("bash backend config", () => {
  test("defaults to host when unset", () => {
    expect(resolveBashBackend({})).toBe("host");
  });

  test("accepts host and microsandbox", () => {
    expect(resolveBashBackend({ NAKAMA_BASH_BACKEND: "host" })).toBe("host");
    expect(resolveBashBackend({ NAKAMA_BASH_BACKEND: "microsandbox" })).toBe(
      "microsandbox"
    );
  });

  test("rejects invalid explicit backend", () => {
    expect(() =>
      resolveBashBackend({ NAKAMA_BASH_BACKEND: "firecracker" })
    ).toThrow(/Invalid NAKAMA_BASH_BACKEND/);
  });

  test("network defaults to off; unknown becomes off", () => {
    expect(resolveBashSandboxNetwork({})).toBe("off");
    expect(
      resolveBashSandboxNetwork({ NAKAMA_BASH_SANDBOX_NETWORK: "public" })
    ).toBe("public");
    expect(
      resolveBashSandboxNetwork({ NAKAMA_BASH_SANDBOX_NETWORK: "weird" })
    ).toBe("off");
  });

  test("sandbox image defaults to alpine", () => {
    expect(resolveBashSandboxImage({})).toBe("alpine");
    expect(
      resolveBashSandboxImage({ NAKAMA_BASH_SANDBOX_IMAGE: "python" })
    ).toBe("python");
  });
});

describe("bash sandbox env", () => {
  test("strips secret keys from overrides and host bleed", () => {
    const env = buildBashSandboxEnv({
      hostEnv: {
        OPENAI_API_KEY: "host-secret",
        PATH: "/bin",
      },
      overrides: {
        AWS_ACCESS_KEY_ID: "AKIA",
        DATABASE_URL: "postgres://x",
        FOO: "bar",
        MY_TOKEN: "nope",
        OPENAI_API_KEY: "override-secret",
      },
      workspaceRoot: "/workspace",
    });

    expect(env.PATH).toBeUndefined();
    expect(env.FOO).toBe("bar");
    expect(env.NAKAMA_WORKSPACE_ROOT).toBe("/workspace");
    expect(env.HOME).toBe("/workspace");
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.MY_TOKEN).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.AWS_ACCESS_KEY_ID).toBeUndefined();
    expect(
      buildBashSandboxEnv({
        overrides: { ANTHROPIC_API_KEY: "x" },
      }).ANTHROPIC_API_KEY
    ).toBeUndefined();
  });
});

describe("profile sandbox helpers", () => {
  test("maps host cwd into guest workspace", () => {
    expect(
      toGuestCwd({
        guestWorkspace: "/workspace",
        hostCwd: "/host/a",
        hostWorkspace: "/host/a",
      })
    ).toBe("/workspace");
    expect(
      toGuestCwd({
        guestWorkspace: "/workspace",
        hostCwd: "/host/a/nested",
        hostWorkspace: "/host/a",
      })
    ).toBe("/workspace/nested");
  });

  test("builds distinct sandbox names per profile", () => {
    expect(profileSandboxName("org_1", "profile_a")).not.toBe(
      profileSandboxName("org_1", "profile_b")
    );
  });
});

describe("bash microsandbox path with fake runtime", () => {
  let workspaceRoot = "";
  let workspaceB = "";

  afterEach(async () => {
    resetBashSandboxManagerForTests();
    if (workspaceRoot) {
      await rm(workspaceRoot, { force: true, recursive: true });
      workspaceRoot = "";
    }
    if (workspaceB) {
      await rm(workspaceB, { force: true, recursive: true });
      workspaceB = "";
    }
  });

  function createFakeRuntime(options?: {
    failProbe?: boolean;
    timeout?: boolean;
  }): BashSandboxRuntime & {
    ensures: BashSandboxEnsureArgs[];
    execs: BashSandboxExecArgs[];
  } {
    const ensures: BashSandboxEnsureArgs[] = [];
    const execs: BashSandboxExecArgs[] = [];
    return {
      async ensure(args) {
        if (options?.failProbe) {
          throw new Error(
            "MicroSandbox backend unavailable: runtime is not installed. No host fallback."
          );
        }
        ensures.push(args);
      },
      ensures,
      async exec(args) {
        execs.push(args);
        if (options?.timeout) {
          return {
            exitCode: null,
            stderr: "",
            stdout: "",
            timedOut: true,
          };
        }
        if (args.signal?.aborted) {
          throw new Error("The operation was aborted");
        }
        return {
          exitCode: 0,
          stderr: "",
          stdout: `ran:${args.command}:cwd=${args.guestCwd}`,
          timedOut: false,
        };
      },
      execs,
    };
  }

  test("reuses one sandbox create per profile", async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "nakama-bash-msb-"));
    const fake = createFakeRuntime();
    const manager = new ProfileSandboxManager(fake);

    const ctx = { orgId: "org_test", profileId: "profile_a" };
    await runBash({ command: "echo 1" }, ctx, {
      backend: "microsandbox",
      sandboxManager: manager,
      workspaceRoot,
    });
    await runBash({ command: "echo 2" }, ctx, {
      backend: "microsandbox",
      sandboxManager: manager,
      workspaceRoot,
    });

    expect(fake.ensures).toHaveLength(1);
    expect(fake.execs).toHaveLength(2);
    expect(fake.ensures[0]?.network).toBe("off");
    expect(fake.ensures[0]?.image).toBe("alpine");
    expect(fake.ensures[0]?.hostWorkspace.length).toBeGreaterThan(0);
  });

  test("uses distinct sandboxes and mounts for two profiles", async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "nakama-bash-msb-a-"));
    workspaceB = await mkdtemp(path.join(os.tmpdir(), "nakama-bash-msb-b-"));
    const fake = createFakeRuntime();
    const manager = new ProfileSandboxManager(fake);

    await runBash(
      { command: "echo a" },
      { orgId: "org_test", profileId: "profile_a" },
      { backend: "microsandbox", sandboxManager: manager, workspaceRoot }
    );
    await runBash(
      { command: "echo b" },
      { orgId: "org_test", profileId: "profile_b" },
      {
        backend: "microsandbox",
        sandboxManager: manager,
        workspaceRoot: workspaceB,
      }
    );

    expect(fake.ensures).toHaveLength(2);
    expect(fake.ensures[0]?.name).not.toBe(fake.ensures[1]?.name);
    expect(fake.ensures[0]?.hostWorkspace).not.toBe(
      fake.ensures[1]?.hostWorkspace
    );
  });

  test("timeout keeps sandbox ensured", async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "nakama-bash-msb-"));
    const fake = createFakeRuntime({ timeout: true });
    const manager = new ProfileSandboxManager(fake);

    const result = await runBash(
      { command: "sleep 99", timeoutMs: 10 },
      { orgId: "org_test", profileId: "profile_a" },
      { backend: "microsandbox", sandboxManager: manager, workspaceRoot }
    );

    expect(result.timedOut).toBe(true);
    expect(fake.ensures).toHaveLength(1);

    await runBash(
      { command: "echo after", timeoutMs: 10 },
      { orgId: "org_test", profileId: "profile_a" },
      { backend: "microsandbox", sandboxManager: manager, workspaceRoot }
    );
    expect(fake.ensures).toHaveLength(1);
  });

  test("clears warm claim when exec fails so next call re-ensures", async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "nakama-bash-msb-"));
    let failNextExec = true;
    const ensures: BashSandboxEnsureArgs[] = [];
    const fake: BashSandboxRuntime & { ensures: BashSandboxEnsureArgs[] } = {
      async ensure(args) {
        ensures.push(args);
      },
      ensures,
      async exec() {
        if (failNextExec) {
          failNextExec = false;
          throw new Error(
            "MicroSandbox backend unavailable: sandbox connect failed. No host fallback."
          );
        }
        return {
          exitCode: 0,
          stderr: "",
          stdout: "recovered",
          timedOut: false,
        };
      },
    };
    const manager = new ProfileSandboxManager(fake);
    const ctx = { orgId: "org_test", profileId: "profile_a" };
    const opts = {
      backend: "microsandbox" as const,
      sandboxManager: manager,
      workspaceRoot,
    };

    await expect(runBash({ command: "echo 1" }, ctx, opts)).rejects.toThrow(
      /No host fallback/
    );
    expect(fake.ensures).toHaveLength(1);

    const result = await runBash({ command: "echo 2" }, ctx, opts);
    expect(result.stdout).toBe("recovered");
    expect(fake.ensures).toHaveLength(2);
  });

  test("fail-closed when probe fails", async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "nakama-bash-msb-"));
    const fake = createFakeRuntime({ failProbe: true });
    const manager = new ProfileSandboxManager(fake);

    await expect(
      runBash(
        { command: "echo hi" },
        { orgId: "org_test", profileId: "profile_a" },
        { backend: "microsandbox", sandboxManager: manager, workspaceRoot }
      )
    ).rejects.toThrow(/No host fallback/);
    expect(fake.execs).toHaveLength(0);
  });

  test("codingAgent is unsupported under microsandbox", async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "nakama-bash-msb-"));
    const fake = createFakeRuntime();
    const manager = new ProfileSandboxManager(fake);

    await expect(
      runBash(
        { codingAgent: true, command: "echo hi" },
        { orgId: "org_test", profileId: "profile_a" },
        { backend: "microsandbox", sandboxManager: manager, workspaceRoot }
      )
    ).rejects.toThrow(/codingAgent is unsupported/);
    expect(fake.ensures).toHaveLength(0);
  });

  test("host backend ignores microsandbox runtime", async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "nakama-bash-msb-"));
    const fake = createFakeRuntime({ failProbe: true });
    const manager = new ProfileSandboxManager(fake);

    const result = await runBash(
      { command: "echo ok" },
      { orgId: "org_test", profileId: "profile_a" },
      { backend: "host", sandboxManager: manager, workspaceRoot }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("ok");
    expect(fake.ensures).toHaveLength(0);
  });

  test("recreates sandbox when network fingerprint changes", async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "nakama-bash-msb-"));
    const fake = createFakeRuntime();
    const manager = new ProfileSandboxManager(fake);
    const prev = process.env.NAKAMA_BASH_SANDBOX_NETWORK;

    try {
      process.env.NAKAMA_BASH_SANDBOX_NETWORK = "public";
      await runBash(
        { command: "echo 1" },
        { orgId: "org_test", profileId: "profile_a" },
        { backend: "microsandbox", sandboxManager: manager, workspaceRoot }
      );
      process.env.NAKAMA_BASH_SANDBOX_NETWORK = "off";
      await runBash(
        { command: "echo 2" },
        { orgId: "org_test", profileId: "profile_a" },
        { backend: "microsandbox", sandboxManager: manager, workspaceRoot }
      );
    } finally {
      if (prev === undefined) {
        delete process.env.NAKAMA_BASH_SANDBOX_NETWORK;
      } else {
        process.env.NAKAMA_BASH_SANDBOX_NETWORK = prev;
      }
    }

    expect(fake.ensures).toHaveLength(2);
    expect(fake.ensures[0]?.network).toBe("public");
    expect(fake.ensures[1]?.network).toBe("off");
  });

  test("strips secret env overrides on microsandbox path", async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "nakama-bash-msb-"));
    const fake = createFakeRuntime();
    const manager = new ProfileSandboxManager(fake);

    await runBash(
      {
        command: "env",
        env: { FOO: "bar", OPENAI_API_KEY: "secret" },
      },
      { orgId: "org_test", profileId: "profile_a" },
      { backend: "microsandbox", sandboxManager: manager, workspaceRoot }
    );

    expect(fake.execs[0]?.env.FOO).toBe("bar");
    expect(fake.execs[0]?.env.OPENAI_API_KEY).toBeUndefined();
    expect(fake.execs[0]?.env.NAKAMA_WORKSPACE_ROOT).toBe("/workspace");
  });

  test("nested cwd maps to guest path", async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "nakama-bash-msb-"));
    await mkdir(path.join(workspaceRoot, "nested"), { recursive: true });
    const fake = createFakeRuntime();
    const manager = new ProfileSandboxManager(fake);

    await runBash(
      { command: "pwd", cwd: "nested" },
      { orgId: "org_test", profileId: "profile_a" },
      { backend: "microsandbox", sandboxManager: manager, workspaceRoot }
    );

    expect(fake.execs[0]?.guestCwd).toBe("/workspace/nested");
  });

  test("still rejects cwd outside workspace on microsandbox path", async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "nakama-bash-msb-"));
    const fake = createFakeRuntime();
    const manager = new ProfileSandboxManager(fake);

    await expect(
      runBash(
        { command: "pwd", cwd: "/tmp" },
        { orgId: "org_test", profileId: "profile_a" },
        { backend: "microsandbox", sandboxManager: manager, workspaceRoot }
      )
    ).rejects.toBeInstanceOf(PathGuardError);
  });
});
