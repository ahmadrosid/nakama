import { afterEach, describe, expect, test } from "bun:test";
import { distillToolResult, isOmniEnabled, omniRetrieveTool } from "./omni";

const CTX = { orgId: "org_test", sessionId: "sess_test" };
const LONG =
  "line of shell output with enough words to be worth folding\n".repeat(200);

const original = process.env.NAKAMA_OMNI;
afterEach(() => {
  if (original === undefined) {
    delete process.env.NAKAMA_OMNI;
  } else {
    process.env.NAKAMA_OMNI = original;
  }
  process.env.PATH = REAL_PATH;
});
const REAL_PATH = process.env.PATH ?? "";

describe("omni gating", () => {
  test("on unless NAKAMA_OMNI=0", () => {
    delete process.env.NAKAMA_OMNI;
    expect(isOmniEnabled()).toBe(true);
    process.env.NAKAMA_OMNI = "1";
    expect(isOmniEnabled()).toBe(true);
    process.env.NAKAMA_OMNI = "0";
    expect(isOmniEnabled()).toBe(false);
    process.env.NAKAMA_OMNI = " 0 ";
    expect(isOmniEnabled()).toBe(false);
  });

  test("disabled returns the result untouched", async () => {
    process.env.NAKAMA_OMNI = "0";
    const result = { exitCode: 0, stdout: LONG };
    expect(await distillToolResult("bash", result, CTX)).toBe(result);
  });
});

describe("knowledge_base_search", () => {
  const longMatches = Array.from({ length: 30 }, (_, index) => ({
    file: `doc-${index}.txt`,
    line: index + 1,
    scope: "profile" as const,
    text: "a sentence of retrieved regulation text worth folding twice over",
  }));

  function savingsProbe() {
    const seen: { bytesIn: number; bytesOut: number; tool: string }[] = [];
    return {
      ctx: {
        ...CTX,
        recordToolOutputSavings: (saving: {
          bytesIn: number;
          bytesOut: number;
          optimizer: string;
          tool: string;
        }) => seen.push(saving),
      },
      seen,
    };
  }

  test("measures the matches array, not the envelope", async () => {
    process.env.NAKAMA_OMNI = "1";
    const { ctx, seen } = savingsProbe();
    const result = {
      matchCount: longMatches.length,
      matches: longMatches,
      query: "ketinggian",
      root: "/kb",
      truncated: false,
    };

    await distillToolResult("knowledge_base_search", result, ctx);

    // The bytes it reports are the ones it read. Reading the envelope, or
    // reading nothing, both show up here rather than passing silently.
    expect(seen).toHaveLength(1);
    expect(seen[0]?.tool).toBe("knowledge_base_search");
    expect(seen[0]?.bytesIn).toBe(JSON.stringify(longMatches).length);
  });

  test("a result with no hits is left alone entirely", async () => {
    process.env.NAKAMA_OMNI = "1";
    const { ctx, seen } = savingsProbe();
    const result = {
      matchCount: 0,
      matches: [],
      query: "ketinggian",
      root: "/kb",
      truncated: false,
    };

    expect(await distillToolResult("knowledge_base_search", result, ctx)).toBe(
      result
    );
    // Not even a control-arm row: there was nothing to measure.
    expect(seen).toHaveLength(0);
  });

  test("a short result reports the control arm and keeps its hits", async () => {
    process.env.NAKAMA_OMNI = "1";
    const { ctx, seen } = savingsProbe();
    const matches = [{ file: "a.txt", line: 1, scope: "profile", text: "hi" }];
    const result = { matchCount: 1, matches, query: "hi", truncated: false };

    expect(await distillToolResult("knowledge_base_search", result, ctx)).toBe(
      result
    );
    expect(seen[0]?.bytesIn).toBe(JSON.stringify(matches).length);
    expect(seen[0]?.bytesIn).toBe(seen[0]?.bytesOut);
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
    //
    // Observed through the recorder rather than through the returned object:
    // without the binary the optimiser fails open and returns the very same
    // object, so identity would only prove that OMNI happens to be installed on
    // the machine running the test. The recorder fires either way, and only
    // once the scope gate has passed.
    process.env.PATH = "/nonexistent";
    const seen: string[] = [];
    await distillToolResult("bash", result, {
      automationRunId: "run_1",
      orgId: "o",
      recordToolOutputSavings: (saving) => seen.push(saving.tool),
    });
    expect(seen).toEqual(["bash"]);

    // And the other way: no scope at all means it never reaches the recorder.
    const unscoped: string[] = [];
    await distillToolResult("bash", result, {
      orgId: "o",
      recordToolOutputSavings: (saving) => unscoped.push(saving.tool),
    });
    expect(unscoped).toEqual([]);
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
