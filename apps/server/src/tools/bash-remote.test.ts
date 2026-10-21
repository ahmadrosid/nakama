import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { asTestFetch } from "../providers/test-helpers";
import { runBash } from "./bash";
import { TENANT_BASH_DISABLED } from "./bash-config";

const ENV_KEYS = [
  "NAKAMA_BASH_BACKEND",
  "NAKAMA_BASH_REMOTE_URL",
  "NAKAMA_BASH_REMOTE_TOKEN",
  "NAKAMA_BASH_SANDBOX_NETWORK",
  "NAKAMA_TENANT_BASH",
  "NAKAMA_TEST_SERVER_SECRET",
] as const;

const context = { orgId: "org_a", profileId: "profile_b" };

const okOutput = { exitCode: 0, stderr: "", stdout: "hi\n", timedOut: false };

describe("remote bash backend", () => {
  const originalFetch = globalThis.fetch;
  const saved = new Map<string, string | undefined>();
  let calls: Array<{ body: unknown; headers: Headers; url: string }> = [];
  let respond: (init?: RequestInit) => Promise<Response>;

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved.set(key, process.env[key]);
    }

    process.env.NAKAMA_BASH_BACKEND = "remote";
    process.env.NAKAMA_BASH_REMOTE_URL = "https://sandbox.test/v1/exec";
    process.env.NAKAMA_BASH_REMOTE_TOKEN = "remote-token";
    delete process.env.NAKAMA_BASH_SANDBOX_NETWORK;
    delete process.env.NAKAMA_TENANT_BASH;

    calls = [];
    respond = async () => Response.json(okOutput);
    globalThis.fetch = asTestFetch(async (input, init) => {
      calls.push({
        body: JSON.parse(String(init?.body)),
        headers: new Headers(init?.headers),
        url: String(input),
      });

      return await respond(init);
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;

    for (const [key, value] of saved) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  test("posts the command with the sandbox id, mapped cwd, and network off", async () => {
    const result = await runBash(
      { command: "echo hi", cwd: "src/app", timeoutMs: 5000 },
      context
    );

    expect(result).toEqual(okOutput);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://sandbox.test/v1/exec");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer remote-token");
    expect(calls[0]?.body).toEqual({
      command: "echo hi",
      cwd: "/workspace/src/app",
      env: {},
      network: "off",
      sandboxId: "nakama-org_a-profile_b",
      timeoutMs: 5000,
    });
  });

  test("sends only the call's env with secret-shaped keys removed", async () => {
    process.env.NAKAMA_TEST_SERVER_SECRET = "server-only";

    await runBash(
      {
        command: "env",
        env: {
          ANTHROPIC_API_KEY: "a",
          DATABASE_URL: "b",
          GITHUB_TOKEN: "c",
          LANG: "C.UTF-8",
          MY_PASSWORD: "d",
        },
      },
      context
    );

    expect(calls[0]?.body).toHaveProperty("env", { LANG: "C.UTF-8" });
  });

  test("maps absolute /workspace paths and rejects cwd outside it", async () => {
    await runBash({ command: "pwd", cwd: "/workspace/a" }, context);
    expect(calls[0]?.body).toMatchObject({ cwd: "/workspace/a" });

    for (const cwd of ["../etc", "/etc", "/workspace/../root"]) {
      await expect(runBash({ command: "pwd", cwd }, context)).rejects.toThrow();
    }

    expect(calls).toHaveLength(1);
  });

  test("returns partial output when the service reports a timeout", async () => {
    const partial = {
      exitCode: null,
      stderr: "",
      stdout: "partial",
      timedOut: true,
    };

    respond = async () => Response.json(partial);

    expect(await runBash({ command: "sleep 99" }, context)).toEqual(partial);
  });

  test("aborts the request when the turn is cancelled", async () => {
    let requestSignal: AbortSignal | null | undefined;

    respond = (init) => {
      requestSignal = init?.signal;

      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError"))
        );
      });
    };

    const controller = new AbortController();

    const run = runBash(
      { command: "sleep 99" },
      { ...context, signal: controller.signal }
    );

    controller.abort();

    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    expect(requestSignal?.aborted).toBe(true);
  });

  test("fails closed without falling back to host bash", async () => {
    const failures: Array<() => void> = [
      () => {
        delete process.env.NAKAMA_BASH_REMOTE_URL;
      },
      () => {
        delete process.env.NAKAMA_BASH_REMOTE_TOKEN;
      },
      () => {
        process.env.NAKAMA_BASH_REMOTE_URL = "file:///tmp/sock";
      },
      () => {
        respond = async () => new Response("no", { status: 401 });
      },
      () => {
        respond = async () => new Response("down", { status: 503 });
      },
      () => {
        respond = () => Promise.reject(new TypeError("connect ECONNREFUSED"));
      },
      () => {
        respond = async () => Response.json({ stdout: "x" });
      },
    ];

    for (const breakConfig of failures) {
      process.env.NAKAMA_BASH_REMOTE_URL = "https://sandbox.test/v1/exec";
      process.env.NAKAMA_BASH_REMOTE_TOKEN = "remote-token";
      breakConfig();

      await expect(
        runBash({ command: "echo host" }, context)
      ).rejects.toThrow();
    }
  });

  test("rejects coding-agent runs", async () => {
    await expect(
      runBash({ codingAgent: true, command: "codex exec hi" }, context)
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  test("keeps the NAKAMA_TENANT_BASH gate", async () => {
    process.env.NAKAMA_TENANT_BASH = "0";

    await expect(runBash({ command: "echo hi" }, context)).rejects.toThrow(
      TENANT_BASH_DISABLED
    );
    expect(calls).toHaveLength(0);
  });

  test("keeps the CLI channel on host bash", async () => {
    const result = await runBash(
      { command: "echo hi" },
      { ...context, channel: "cli", codingWorkspaceRoot: process.cwd() }
    );

    expect(result.stdout).toBe("hi\n");
    expect(calls).toHaveLength(0);
  });

  test("sends network public only when the operator opts in", async () => {
    process.env.NAKAMA_BASH_SANDBOX_NETWORK = "public";
    await runBash({ command: "curl example.com" }, context);
    expect(calls[0]?.body).toMatchObject({ network: "public" });

    process.env.NAKAMA_BASH_SANDBOX_NETWORK = "on";
    await expect(runBash({ command: "true" }, context)).rejects.toThrow();
  });

  test("rejects an unknown backend", async () => {
    process.env.NAKAMA_BASH_BACKEND = "microsandbox";

    await expect(runBash({ command: "true" }, context)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});
