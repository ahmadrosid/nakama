import { describe, expect, test } from "bun:test";
import type { ToolContext } from "@nakama/core";
import {
  CUSTOM_TOOL_HANDLERS,
  getCustomToolHandler,
  TOOL_RETRY_LIMIT,
  withToolRetries,
} from "./custom-tool-handlers";

function ctx(signal?: AbortSignal): ToolContext {
  return { signal };
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
});
