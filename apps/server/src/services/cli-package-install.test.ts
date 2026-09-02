import { describe, expect, test } from "bun:test";
import { runTimedInstallCommand } from "./cli-package-install";

const STALLING_PLAN = {
  args: ["-c", "printf partial; exec sleep 5"],
  command: "sh",
  displayCommand: "sh -c 'printf partial; exec sleep 5'",
};

/**
 * Exits on its own inside the window the late-progress test waits out, so that
 * test still sees the late flush if SIGTERM is ever lost or slow.
 */
const SELF_EXITING_PLAN = {
  args: ["-c", "printf partial; exec sleep 1"],
  command: "sh",
  displayCommand: "sh -c 'printf partial; exec sleep 1'",
};

/**
 * Ignores SIGTERM, so it only dies once the escalation lands. Exits on its own
 * after a second, which bounds every test that uses it and lets those tests put
 * an upper bound on the wait: passing late enough to be the self-exit is a
 * failure, not a pass.
 */
const SIGTERM_IGNORING_PLAN = {
  args: ["-c", "trap '' TERM; printf partial; sleep 1"],
  command: "sh",
  displayCommand: "sh -c \"trap '' TERM; printf partial; sleep 1\"",
};

/**
 * Exits at once but leaves something holding the stdout pipe, so `close` stays
 * outstanding long after the process itself is gone.
 */
const PIPE_HOLDING_PLAN = {
  args: ["-c", "sh -c 'sleep 3' & printf 'hi\\n'; exit 0"],
  command: "sh",
  displayCommand: "sh -c \"sh -c 'sleep 3' & printf 'hi\\n'; exit 0\"",
};

describe("runTimedInstallCommand", () => {
  test("gives up on an installer that outlives the timeout", async () => {
    const result = await runTimedInstallCommand(STALLING_PLAN, undefined, {
      timeoutMs: 50,
    });

    expect(result.timedOut).toBe(true);
  });

  test("stops reporting progress once the timeout has resolved", async () => {
    const late: string[] = [];
    let settled = false;

    await runTimedInstallCommand(
      SELF_EXITING_PLAN,
      (message) => {
        if (settled) {
          late.push(message);
        }
      },
      { timeoutMs: 50 }
    );
    settled = true;

    await new Promise((resolve) => setTimeout(resolve, 1500));

    expect(late).toEqual([]);
  });

  test("reports every progress line from an installer that finishes in time", async () => {
    const progress: string[] = [];

    const result = await runTimedInstallCommand(
      {
        args: ["-c", "printf 'one\\ntwo'"],
        command: "sh",
        displayCommand: "sh -c \"printf 'one\\ntwo'\"",
      },
      (message) => progress.push(message),
      { timeoutMs: 5000 }
    );

    expect({
      exitCode: result.exitCode,
      progress,
      timedOut: result.timedOut,
    }).toEqual({
      exitCode: 0,
      progress: ["stdout: one", "stdout: two"],
      timedOut: false,
    });
  });
  test("settles only once the timed-out installer has actually exited", async () => {
    const startedAt = performance.now();

    const result = await runTimedInstallCommand(
      SIGTERM_IGNORING_PLAN,
      undefined,
      {
        sigtermGraceMs: 200,
        timeoutMs: 50,
      }
    );
    const elapsedMs = performance.now() - startedAt;

    expect({
      settledAfterTheEscalation: elapsedMs >= 250,
      settledBeforeTheSelfExit: elapsedMs < 800,
      timedOut: result.timedOut,
    }).toEqual({
      settledAfterTheEscalation: true,
      settledBeforeTheSelfExit: true,
      timedOut: true,
    });
  });

  test("gives up waiting when the kill escalation has not landed yet", async () => {
    const startedAt = performance.now();

    const result = await runTimedInstallCommand(
      SIGTERM_IGNORING_PLAN,
      undefined,
      {
        settleTimeoutMs: 150,
        sigtermGraceMs: 10_000,
        timeoutMs: 50,
      }
    );
    const elapsedMs = performance.now() - startedAt;

    expect({
      settledAfterTheSettleBound: elapsedMs >= 200,
      settledBeforeTheSelfExit: elapsedMs < 800,
      timedOut: result.timedOut,
    }).toEqual({
      settledAfterTheSettleBound: true,
      settledBeforeTheSelfExit: true,
      timedOut: true,
    });
  });
  test("does not wait out the settle bound for a process that already exited", async () => {
    const startedAt = performance.now();

    const result = await runTimedInstallCommand(PIPE_HOLDING_PLAN, undefined, {
      timeoutMs: 200,
    });
    const elapsedMs = performance.now() - startedAt;

    expect({
      settledAtTheDeadline: elapsedMs >= 200 && elapsedMs < 1200,
      timedOut: result.timedOut,
    }).toEqual({
      settledAtTheDeadline: true,
      timedOut: true,
    });
  });
});
