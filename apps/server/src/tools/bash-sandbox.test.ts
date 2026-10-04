import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PathGuardError } from "@nakama/core";
import {
  type ExecEvent,
  type ExecHandle,
  ExecTimeoutError,
  Sandbox,
  type SandboxHandle,
} from "microsandbox";
import { resetBashSandboxManagerForTests, runBash } from "./bash";
import {
  resolveBashBackend,
  resolveBashSandboxImage,
  resolveBashSandboxNetwork,
} from "./bash-config";
import {
  createBoundedOutput,
  MicrosandboxBashRuntime,
} from "./bash-microsandbox-runtime";
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
    expect(
      toGuestCwd({
        guestWorkspace: "/workspace",
        hostCwd: "C:\\host\\a\\nested",
        hostWorkspace: "C:\\host\\a",
      })
    ).toBe("/workspace/nested");
    expect(() =>
      toGuestCwd({
        guestWorkspace: "/workspace",
        hostCwd: "C:\\host\\another",
        hostWorkspace: "C:\\host\\a",
      })
    ).toThrow();
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
  }, 15_000);

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

describe("microsandbox adapter cancellation", () => {
  afterEach(() => mock.restore());

  const execArgs = {
    command: "echo hi",
    env: {},
    guestCwd: "/workspace",
    name: "test-sandbox",
    timeoutMs: 1000,
  };

  function fakeSdk(
    events: () => AsyncGenerator<ExecEvent> = async function* () {
      yield { code: 0, kind: "exited" };
    }
  ) {
    const kill = mock(() => Promise.resolve());
    const handle = {
      kill,
      [Symbol.asyncIterator]: events,
    } as unknown as ExecHandle;
    const execStreamWith = mock(() => Promise.resolve(handle));
    const sandbox = { execStreamWith } as unknown as Sandbox;
    const connect = mock(() => Promise.resolve(sandbox));
    const get = spyOn(Sandbox, "get").mockResolvedValue({
      connect,
      status: "running",
    } as unknown as SandboxHandle);
    return { connect, execStreamWith, get, handle, kill, sandbox };
  }

  test("pre-abort never connects or dispatches", async () => {
    const sdk = fakeSdk();
    const controller = new AbortController();
    controller.abort();

    await expect(
      new MicrosandboxBashRuntime().exec({
        ...execArgs,
        signal: controller.signal,
      })
    ).rejects.toBeInstanceOf(Error);
    expect(sdk.get).not.toHaveBeenCalled();
    expect(sdk.connect).not.toHaveBeenCalled();
    expect(sdk.execStreamWith).not.toHaveBeenCalled();
  });

  test("abort during connection prevents command dispatch", async () => {
    const entered = Promise.withResolvers<void>();
    const connected = Promise.withResolvers<void>();
    const sdk = fakeSdk();
    sdk.connect.mockImplementation(async () => {
      entered.resolve();
      await connected.promise;
      return sdk.sandbox;
    });
    const controller = new AbortController();
    const execution = new MicrosandboxBashRuntime().exec({
      ...execArgs,
      signal: controller.signal,
    });
    await entered.promise;
    controller.abort();
    connected.resolve();

    const outcome = await execution.then(
      () => "resolved",
      () => "rejected"
    );
    expect(sdk.execStreamWith).not.toHaveBeenCalled();
    expect(sdk.kill).not.toHaveBeenCalled();
    expect(outcome).toBe("rejected");
  });

  test("abort during handle creation kills the returned handle", async () => {
    const entered = Promise.withResolvers<void>();
    const created = Promise.withResolvers<void>();
    const sdk = fakeSdk();
    sdk.execStreamWith.mockImplementation(async () => {
      entered.resolve();
      await created.promise;
      return sdk.handle;
    });
    const controller = new AbortController();
    const add = spyOn(controller.signal, "addEventListener");
    const remove = spyOn(controller.signal, "removeEventListener");
    const execution = new MicrosandboxBashRuntime().exec({
      ...execArgs,
      signal: controller.signal,
    });
    await entered.promise;
    controller.abort();
    created.resolve();

    const outcome = await execution.then(
      () => "resolved",
      () => "rejected"
    );
    expect(sdk.execStreamWith).toHaveBeenCalledTimes(1);
    expect(sdk.kill).toHaveBeenCalledTimes(1);
    expect(outcome).toBe("rejected");
    expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0]?.[1]);
  });

  test.each(["exit", "error", "timeout"])(
    "active abort kills the handle and rejects on stream %s",
    async (ending) => {
      const streaming = Promise.withResolvers<void>();
      const finished = Promise.withResolvers<void>();
      const sdk = fakeSdk(async function* () {
        streaming.resolve();
        await finished.promise;
        if (ending === "error") {
          throw new Error("stream closed");
        }
        if (ending === "timeout") {
          throw new ExecTimeoutError("deadline", 1000);
        }
        yield { code: 0, kind: "exited" };
      });
      if (ending === "error") {
        sdk.kill.mockRejectedValue(new Error("already stopped"));
      }
      const controller = new AbortController();
      const add = spyOn(controller.signal, "addEventListener");
      const remove = spyOn(controller.signal, "removeEventListener");
      const execution = new MicrosandboxBashRuntime().exec({
        ...execArgs,
        signal: controller.signal,
      });
      await streaming.promise;
      controller.abort();
      expect(sdk.kill).toHaveBeenCalledTimes(1);
      finished.resolve();

      await expect(execution).rejects.toBeInstanceOf(Error);
      expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0]?.[1]);
      expect(sdk.execStreamWith).toHaveBeenCalledTimes(1);
    }
  );

  test.each([false, true])(
    "preserves bounded output and removes listeners (timeout=%s)",
    async (timedOut) => {
      const sdk = fakeSdk(async function* () {
        yield {
          data: new TextEncoder().encode("x".repeat(32_001)),
          kind: "stdout",
        };
        yield { data: new TextEncoder().encode("warning"), kind: "stderr" };
        if (timedOut) {
          throw new ExecTimeoutError("deadline", 1000);
        }
        yield { code: 7, kind: "exited" };
      });
      const controller = new AbortController();
      const add = spyOn(controller.signal, "addEventListener");
      const remove = spyOn(controller.signal, "removeEventListener");

      expect(
        await new MicrosandboxBashRuntime().exec({
          ...execArgs,
          signal: controller.signal,
        })
      ).toEqual({
        exitCode: timedOut ? null : 7,
        stderr: "warning",
        stdout: `${"x".repeat(32_000)}\n...[truncated]`,
        timedOut,
      });
      expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0]?.[1]);
      controller.abort();
      expect(sdk.kill).not.toHaveBeenCalled();
      expect(sdk.execStreamWith).toHaveBeenCalledTimes(1);
    }
  );

  test.each(["connect", "create", "stream"])(
    "SDK %s failure rejects without retry or leaked listeners",
    async (stage) => {
      const error = new Error("SDK unavailable");
      const sdk = fakeSdk(async function* () {
        yield { data: new TextEncoder().encode("partial"), kind: "stdout" };
        throw error;
      });
      if (stage === "connect") {
        sdk.connect.mockRejectedValue(error);
      } else if (stage === "create") {
        sdk.execStreamWith.mockRejectedValue(error);
      }
      const controller = new AbortController();
      const add = spyOn(controller.signal, "addEventListener");
      const remove = spyOn(controller.signal, "removeEventListener");

      await expect(
        new MicrosandboxBashRuntime().exec({
          ...execArgs,
          signal: controller.signal,
        })
      ).rejects.toBeInstanceOf(Error);
      if (stage === "stream") {
        expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0]?.[1]);
      } else {
        expect(add).not.toHaveBeenCalled();
      }
      controller.abort();
      expect(sdk.kill).not.toHaveBeenCalled();
      expect(sdk.get).toHaveBeenCalledTimes(1);
      expect(sdk.execStreamWith).toHaveBeenCalledTimes(
        stage === "connect" ? 0 : 1
      );
    }
  );
});

describe("profile sandbox concurrency and output bounds", () => {
  const runArgs = {
    command: "echo hi",
    env: {},
    hostCwd: "/w",
    hostWorkspace: "/w",
    image: "alpine",
    network: "off" as const,
    orgId: "org_a",
    profileId: "profile_a",
    timeoutMs: 1000,
  };

  test("two overlapping first runs for one profile ensure once", async () => {
    let ensures = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runtime: BashSandboxRuntime = {
      async ensure() {
        ensures += 1;
        await gate;
      },
      exec(args: BashSandboxExecArgs) {
        return Promise.resolve({
          exitCode: 0,
          stderr: "",
          stdout: `ran:${args.name}`,
          timedOut: false,
        });
      },
    };
    const manager = new ProfileSandboxManager(runtime);

    const both = Promise.all([
      manager.run(runArgs),
      manager.run({ ...runArgs, command: "echo two" }),
    ]);
    release();
    const results = await both;

    // Both callers used to miss the map and ensure, and the builder replaces,
    // so the first exec ran in a microVM the second had already torn down.
    expect(ensures).toBe(1);
    expect(results).toHaveLength(2);
  });

  test("a rejected ensure is not cached, so the next call retries", async () => {
    let ensures = 0;
    const runtime: BashSandboxRuntime = {
      ensure() {
        ensures += 1;
        return ensures === 1
          ? Promise.reject(new Error("msb unavailable"))
          : Promise.resolve();
      },
      exec() {
        return Promise.resolve({
          exitCode: 0,
          stderr: "",
          stdout: "ok",
          timedOut: false,
        });
      },
    };
    const manager = new ProfileSandboxManager(runtime);

    await expect(manager.run(runArgs)).rejects.toThrow("msb unavailable");
    // Holding the in-flight promise would replay that rejection forever.
    await expect(manager.run(runArgs)).resolves.toMatchObject({ exitCode: 0 });
    expect(ensures).toBe(2);
  });

  test("bounded output stops growing and keeps the truncation marker", () => {
    const out = createBoundedOutput(10);
    out.append("12345");
    expect(out.read()).toBe("12345");

    out.append("678901234567890");
    expect(out.read()).toBe("1234567890\n...[truncated]");

    // Past the cap nothing more is retained, which is the whole point.
    out.append("and more");
    expect(out.read()).toBe("1234567890\n...[truncated]");
  });
});
