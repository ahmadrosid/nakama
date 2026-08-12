import { afterEach, describe, expect, test } from "bun:test";
import { distillToolResult, isOmniEnabled, omniRetrieveTool } from "./omni";

const CTX = { orgId: "org_test", sessionId: "sess_test" };
const LONG =
  "line of shell output with enough words to be worth folding\n".repeat(200);

const original = process.env.NAKAMA_OMNI;
afterEach(() => {
  if (original === undefined) {
    process.env.NAKAMA_OMNI = undefined;
    delete process.env.NAKAMA_OMNI;
  } else {
    process.env.NAKAMA_OMNI = original;
  }
  process.env.PATH = REAL_PATH;
});
const REAL_PATH = process.env.PATH ?? "";

describe("omni gating", () => {
  test("off unless NAKAMA_OMNI=1", () => {
    delete process.env.NAKAMA_OMNI;
    expect(isOmniEnabled()).toBe(false);
    process.env.NAKAMA_OMNI = "true";
    expect(isOmniEnabled()).toBe(false);
    process.env.NAKAMA_OMNI = "1";
    expect(isOmniEnabled()).toBe(true);
  });

  test("disabled returns the result untouched", async () => {
    delete process.env.NAKAMA_OMNI;
    const result = { exitCode: 0, stdout: LONG };
    expect(await distillToolResult("bash", result, CTX)).toBe(result);
  });
});

describe("omni result passthrough", () => {
  test("leaves tools it does not handle alone", async () => {
    process.env.NAKAMA_OMNI = "1";
    for (const name of [
      "write_file",
      "edit_file",
      "web_fetch",
      "search_files",
    ]) {
      const result = { content: LONG, stdout: LONG };
      expect(await distillToolResult(name, result, CTX)).toBe(result);
    }
  });

  test("skips output too short to be worth a process spawn", async () => {
    process.env.NAKAMA_OMNI = "1";
    const result = { exitCode: 0, stdout: "small" };
    expect(await distillToolResult("bash", result, CTX)).toBe(result);
  });

  test("does not skip a coding-agent sized summary", async () => {
    // A real cursor-agent result, after cursor-agent-output.ts summarised it,
    // was 1,455 characters and folded to 239 on its second showing. The
    // threshold must sit below that or the coding-agent path gets nothing.
    process.env.NAKAMA_OMNI = "1";
    process.env.PATH = "/nonexistent";
    const summary = "x".repeat(1455);
    const result = { exitCode: 0, stdout: summary };

    // The binary is unreachable so it fails open and returns the same object,
    // but reaching that point at all proves the length gate let it through.
    expect(await distillToolResult("bash", result, CTX)).toBe(result);
    expect(summary.length).toBeGreaterThan(1000);
  });

  test("needs both an org and a conversation scope before it will touch anything", async () => {
    process.env.NAKAMA_OMNI = "1";
    const result = { exitCode: 0, stdout: LONG };
    expect(await distillToolResult("bash", result, { orgId: "o" })).toBe(
      result
    );
    expect(await distillToolResult("bash", result, { sessionId: "s" })).toBe(
      result
    );
    expect(await distillToolResult("bash", result, {})).toBe(result);
    // An automation run has a run id and no session id. It is still one
    // conversation, so it is a valid scope and must not be skipped.
    expect(
      await distillToolResult("bash", result, {
        automationRunId: "run_1",
        orgId: "o",
      })
    ).not.toBe(result);
  });

  test("leaves non-object and fieldless results alone", async () => {
    process.env.NAKAMA_OMNI = "1";
    expect(await distillToolResult("bash", LONG, CTX)).toBe(LONG);
    expect(await distillToolResult("bash", null, CTX)).toBe(null);
    const noField = { exitCode: 1 };
    expect(await distillToolResult("bash", noField, CTX)).toBe(noField);
  });
});

describe("omni fails open", () => {
  // The guarantee that matters: an optimiser that cannot run must cost the
  // caller nothing but time. An empty PATH is the cheapest way to make the
  // binary unreachable without uninstalling it.
  test("returns the caller's bytes when the binary cannot be found", async () => {
    process.env.NAKAMA_OMNI = "1";
    process.env.PATH = "/nonexistent";
    const result = { exitCode: 0, stdout: LONG };

    const out = (await distillToolResult("bash", result, CTX)) as {
      stdout: string;
    };

    expect(out.stdout).toBe(LONG);
    expect(out).toBe(result);
  });

  test("retrieve reports a miss rather than throwing", async () => {
    process.env.PATH = "/nonexistent";
    const out = await omniRetrieveTool.run({ handle: "deadbeef" }, CTX);
    expect(out).toEqual({
      error: "omni_retrieve: nothing archived under deadbeef.",
    });
  });
});

describe("omni install probe", () => {
  test("reports missing when the binary cannot be run", async () => {
    // Fresh module so the cached probe does not leak between tests.
    process.env.PATH = "/nonexistent";
    const fresh = await import(`./omni?probe=${Date.now()}`);
    expect(await fresh.isOmniInstalled()).toBe(false);
  });
});

describe("omni_retrieve input", () => {
  test("rejects a handle that is not hex", async () => {
    for (const handle of ["", "not-hex", "../../etc/passwd", "; rm -rf /"]) {
      const out = await omniRetrieveTool.run({ handle }, CTX);
      expect(out).toEqual({
        error: "omni_retrieve: handle must be a hex string.",
      });
    }
  });

  test("rejects a call with no org context", async () => {
    const out = await omniRetrieveTool.run({ handle: "abcd1234" }, {});
    expect(out).toEqual({ error: "omni_retrieve: no org context." });
  });
});
