/**
 * OMNI as a tool-output optimiser for two tools, in process, with no MCP server.
 *
 * Why only `bash` and `read_file`: replayed against real sessions, OMNI's shell
 * path cuts 37.6% and every point of it comes from the cross-turn ledger folding
 * output the agent has already been shown. Its `Write`/`Edit` arms decline by
 * design, and `web_fetch` is already bounded by MAX_CONTENT_CHARS there.
 *
 * Why not the MCP server: it publishes 26 tools, 8,241 bytes of definitions that
 * ride on every request, which costs more than the distillation saves and makes
 * tool selection worse. One retrieve tool we write ourselves is the whole surface.
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { JsonSchema, ToolContext, ToolDefinition } from "./contract";
import { getOrgMemoryDir } from "./soul/resolve";

/**
 * OMNI matches these exactly and never normalizes them on this payload shape, so
 * `bash` reaches a generic arm that head-truncates and never folds, while `Bash`
 * reaches the real pipeline. Sending the wrong case scores *better* on bytes
 * while losing content, so it fails silently. See fajarhide/omni#488.
 */
const OMNI_TOOL_NAMES: Record<string, string> = {
  bash: "Bash",
  read_file: "Read",
};

/** The field each tool carries its text in. Never the JSON envelope: OMNI passes
 * structured payloads through untouched, so wiring it to the envelope saves zero. */
const TEXT_FIELD: Record<string, string> = {
  bash: "stdout",
  read_file: "content",
};

const HOOK_TIMEOUT_MS = 5000;
/**
 * A latency guard, not a correctness one: spawning a process to shorten a few
 * hundred characters is not worth the round trip. Correctness is handled below,
 * where a replacement that is not strictly shorter is rejected outright.
 *
 * 1,000 rather than something larger because a real coding-agent result, after
 * `cursor-agent-output.ts` has already summarised it, measured 1,455 characters
 * and folded to 239 on the second showing. A 2,000 threshold silently threw that
 * away.
 */
const MIN_CHARS = 1000;
/** Stored beside every saving, so a second optimiser can be told apart later. */
export const OPTIMIZER_ID = "omni";
/**
 * The control arm. Recorded when the optimiser is off, or on but declined, with
 * bytesIn equal to bytesOut.
 *
 * Without it the panel has one arm and nothing to compare against: "6 KB removed"
 * against a blank is not a measurement, it is a restatement of the fact that the
 * feature was switched on. With it, the same chart shows what a turn costs when
 * nothing shortens it.
 *
 * This is still bytes at insertion, not tokens. A token figure needs the
 * provider's own inputTokens split by arm, which is a separate piece of work.
 */
export const CONTROL_ID = "none";

/** The server-wide default, used when no org has chosen. */
export function isOmniEnabled(): boolean {
  return process.env.NAKAMA_OMNI === "1";
}

let installedProbe: Promise<boolean> | null = null;

/**
 * Whether the binary can actually be run here. Probed once and cached, because
 * the answer only changes when the image does.
 *
 * Worth its own signal rather than inferring it from a zero: the optimiser fails
 * open, so a missing binary and an idle day look identical on the panel, and an
 * operator who switched it on deserves to be told it is not there.
 */
export function isOmniInstalled(): Promise<boolean> {
  installedProbe ??= runOmni(["--version"], "", {}).then(
    (out) => out !== null && out.trim().length > 0
  );
  return installedProbe;
}

/**
 * Whether the optimiser runs for this call. An explicit org setting wins in both
 * directions, so an operator who turned it off in the UI is not overridden by
 * the env var, and vice versa.
 */
export function isOmniEnabledFor(context: ToolContext): boolean {
  return context.tokenOptimizerEnabled ?? isOmniEnabled();
}

function omniDbPath(orgId: string): string {
  const dir = getOrgMemoryDir(orgId);
  mkdirSync(dir, { recursive: true });
  return join(dir, "omni.db");
}

/** Runs `omni <args>` with stdin, resolving to null on any failure at all. */
function runOmni(
  args: string[],
  stdin: string,
  env: Record<string, string>
): Promise<string | null> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("omni", args, {
        env: { ...process.env, ...env },
        stdio: ["pipe", "pipe", "ignore"],
      });
    } catch {
      resolve(null);
      return;
    }

    let out = "";
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    // A hung optimiser must never hold a turn. Everything here is an
    // optimisation, so every failure path returns the caller's own bytes.
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(null);
    }, HOOK_TIMEOUT_MS);

    child.stdout?.on("data", (chunk) => {
      out += String(chunk);
    });
    child.on("error", () => finish(null));
    child.on("close", (code) => finish(code === 0 ? out : null));
    child.stdin?.on("error", () => finish(null));
    child.stdin?.end(stdin);
  });
}

/**
 * Shorter text for one tool result, or the result unchanged.
 *
 * Fail open everywhere: a missing binary, a timeout, a parse failure or an
 * unrecognised shape all return exactly what was passed in. The one thing this
 * must never do is hand the model a summary of something it guessed at.
 */
export async function distillToolResult(
  toolName: string,
  result: unknown,
  context: ToolContext
): Promise<unknown> {
  const omniName = OMNI_TOOL_NAMES[toolName];
  const field = TEXT_FIELD[toolName];
  const orgId = context.orgId?.trim();
  // Automation runs carry no sessionId, only a run id, and that run is exactly
  // one conversation. Scoping by anything broader would let the ledger claim a
  // run had already been shown output that went somewhere else, which is a false
  // statement rather than a missed saving.
  const scope = context.sessionId?.trim() || context.automationRunId?.trim();

  if (!(omniName && field && orgId && scope)) {
    return result;
  }
  if (typeof result !== "object" || result === null) {
    return result;
  }

  const record = result as Record<string, unknown>;
  const text = record[field];
  if (typeof text !== "string" || text.length === 0) {
    return result;
  }

  // Reporting must never break the thing it reports on.
  const report = (optimizer: string, bytesOut: number) => {
    try {
      context.recordToolOutputSavings?.({
        bytesIn: text.length,
        bytesOut,
        optimizer,
        tool: toolName,
      });
    } catch {
      // ignored on purpose
    }
  };

  // Every path below that leaves the text alone reports the control arm, so the
  // panel can show what a turn costs when nothing shortens it. Without that row
  // the comparison is a number against a blank, which measures nothing.
  if (!isOmniEnabledFor(context) || text.length < MIN_CHARS) {
    report(CONTROL_ID, text.length);
    return result;
  }

  const payload = JSON.stringify({
    hook_event_name: "PostToolUse",
    session_id: scope,
    tool_input: { command: toolName },
    tool_name: omniName,
    tool_response: { stdout: text },
  });

  const raw = await runOmni(["--post-hook"], payload, {
    OMNI_AGENT_ID: "nakama",
    OMNI_DB_PATH: omniDbPath(orgId),
  });

  // Empty stdout is OMNI declining to change anything, which is not a failure.
  if (!raw?.trim()) {
    report(CONTROL_ID, text.length);
    return result;
  }

  let replacement: unknown;
  try {
    replacement =
      JSON.parse(raw)?.hookSpecificOutput?.updatedToolOutput?.stdout;
  } catch {
    report(CONTROL_ID, text.length);
    return result;
  }

  // Never accept a "shorter" version that is longer, and never accept an empty
  // one: both mean the contract changed under us.
  if (
    typeof replacement !== "string" ||
    replacement.length === 0 ||
    replacement.length >= text.length
  ) {
    report(CONTROL_ID, text.length);
    return result;
  }

  report(OPTIMIZER_ID, replacement.length);

  return { ...record, [field]: replacement, omniDistilled: true };
}

const OMNI_RETRIEVE_TOOL_NAME = "omni_retrieve";

const retrieveParameters: JsonSchema = {
  additionalProperties: false,
  properties: {
    handle: {
      description: "The hex handle printed in an [OMNI: ...] marker.",
      type: "string",
    },
  },
  required: ["handle"],
  type: "object",
};

/**
 * The whole reason folding is allowed. OMNI archives what it folds and prints a
 * handle; without a way to expand it the agent has been told content existed and
 * given no way to read it, which is worse than an honest truncation. The
 * description is deliberately short because it is billed on every request.
 */
export const omniRetrieveTool: ToolDefinition<
  { handle: string },
  { content: string } | { error: string }
> = {
  description:
    "Expand an [OMNI: ...] marker back to the full text it replaced, by its handle.",
  name: OMNI_RETRIEVE_TOOL_NAME,
  parallelSafe: true,
  parameters: retrieveParameters,
  async run(input, context) {
    const handle = typeof input?.handle === "string" ? input.handle.trim() : "";
    const orgId = context.orgId?.trim();

    if (!/^[0-9a-f]{4,64}$/.test(handle)) {
      return { error: "omni_retrieve: handle must be a hex string." };
    }
    if (!orgId) {
      return { error: "omni_retrieve: no org context." };
    }

    const out = await runOmni(["retrieve", handle], "", {
      OMNI_AGENT_ID: "nakama",
      OMNI_DB_PATH: omniDbPath(orgId),
    });

    if (out === null) {
      return { error: `omni_retrieve: nothing archived under ${handle}.` };
    }
    return { content: out };
  },
};
