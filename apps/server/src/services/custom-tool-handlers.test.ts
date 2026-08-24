import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ToolContext } from "@nakama/core";
import type { StoredToolRecord } from "@nakama/db";
import {
  CUSTOM_TOOL_HANDLERS,
  getCustomToolHandler,
  TOOL_RETRY_LIMIT,
  withToolRetries,
} from "./custom-tool-handlers";

function ctx(signal?: AbortSignal): ToolContext {
  return { signal };
}

const originalConfigDir = process.env.NAKAMA_CONFIG_DIR;

function makeRecord(
  overrides: Partial<StoredToolRecord> = {}
): StoredToolRecord {
  return {
    createdAt: new Date().toISOString(),
    description: "Retry probe",
    handlerConfig: { modulePath: "flaky.py" },
    handlerType: "python",
    id: "tool_flaky",
    name: "flaky",
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("withToolRetries", () => {
  test("succeeds on the first attempt without extra calls", async () => {
    let attempts = 0;
    const run = async () => {
      attempts += 1;
      return { ok: true };
    };

    const result = await withToolRetries(run)({}, ctx());

    expect(result).toEqual({ ok: true });
    expect(attempts).toBe(1);
  });

  test("retries at most twice and returns success when a later attempt succeeds", async () => {
    let attempts = 0;
    const run = async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new Error("transient");
      }
      return { ok: true };
    };

    const result = await withToolRetries(run)({}, ctx());

    expect(result).toEqual({ ok: true });
    expect(attempts).toBe(3);
  });

  test("stops after two retries and re-throws the last error unchanged", async () => {
    let attempts = 0;
    const message =
      "Python tool timed out after 8000ms (exit code null): (no stderr)";
    const run = async () => {
      attempts += 1;
      throw new Error(message);
    };

    await expect(withToolRetries(run)({}, ctx())).rejects.toThrow(message);
    expect(attempts).toBe(TOOL_RETRY_LIMIT + 1);
  });

  test("an aborted signal during the run stops immediately and is never retried", async () => {
    let attempts = 0;
    const controller = new AbortController();
    const run = async () => {
      attempts += 1;
      controller.abort(new Error("cancelled"));
      throw new Error("boom");
    };

    await expect(
      withToolRetries(run)({}, ctx(controller.signal))
    ).rejects.toThrow("boom");
    expect(attempts).toBe(1);
  });

  test("an already-aborted signal never starts the run", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    let attempts = 0;
    const run = async () => {
      attempts += 1;
      return { ok: true };
    };

    await expect(
      withToolRetries(run)({}, ctx(controller.signal))
    ).rejects.toThrow("cancelled");
    expect(attempts).toBe(0);
  });

  test("aborting during the backoff cancels the retry", async () => {
    let attempts = 0;
    const controller = new AbortController();
    const run = async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("transient");
      }
      return { ok: true };
    };

    const pending = withToolRetries(run)({}, ctx(controller.signal));
    setTimeout(() => controller.abort(), 25);

    await expect(pending).rejects.toThrow();
    // Never reached the second attempt.
    expect(attempts).toBe(1);
  });
});

describe("getCustomToolHandler seam", () => {
  test("applies the retry wrapper to both javascript and python handlers", () => {
    for (const type of ["javascript", "python"] as const) {
      const viaSeam = getCustomToolHandler(type);
      expect(viaSeam).not.toBeNull();
      // The seam returns a wrapped load, distinct from the raw loader.
      expect(viaSeam!.load).not.toBe(CUSTOM_TOOL_HANDLERS[type].load);
    }
  });

  test("returns null for unknown handler types", () => {
    expect(getCustomToolHandler("ruby")).toBeNull();
  });

  test("python handler failures are actually retried through the seam", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "nakama-config-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;
    const toolsDir = path.join(configDir, "tools");
    const wsDir = path.join(configDir, "ws");
    await mkdir(toolsDir, { recursive: true });
    await mkdir(wsDir, { recursive: true });

    // The module persists an attempt counter in the workspace, fails while the
    // count is below 3, then succeeds — so the test can assert the actual
    // number of spawns, not just the final result.
    await writeFile(
      path.join(toolsDir, "flaky.py"),
      `import json, os, sys

def run(input, context):
    root = os.environ.get("NAKAMA_WORKSPACE_ROOT", "/tmp")
    counter = os.path.join(root, "attempts.txt")
    n = 0
    if os.path.exists(counter):
        n = int(open(counter).read().strip() or "0")
    n += 1
    open(counter, "w").write(str(n))
    if n < 3:
        sys.stderr.write("flaky\\n")
        sys.exit(3)
    return {"ok": True, "attempts": n}

if __name__ == "__main__":
    payload = json.loads(sys.stdin.read() or "{}")
    sys.stdout.write(json.dumps(run(payload, {})))
`,
      "utf8"
    );

    try {
      const handler = getCustomToolHandler("python");
      expect(handler).not.toBeNull();
      const tool = await handler!.load(makeRecord());
      expect(tool).not.toBeNull();

      const result = (await tool!.run({}, { workspaceRoot: wsDir })) as {
        ok: boolean;
        attempts: number;
      };

      // Succeeded on attempt 3 after two failed spawns — proves the retry
      // policy reaches the python loader, not just the seam wrapper.
      expect(result.ok).toBe(true);
      expect(result.attempts).toBe(3);
    } finally {
      if (originalConfigDir === undefined) {
        delete process.env.NAKAMA_CONFIG_DIR;
      } else {
        process.env.NAKAMA_CONFIG_DIR = originalConfigDir;
      }
      await rm(configDir, { force: true, recursive: true });
    }
  });
});
