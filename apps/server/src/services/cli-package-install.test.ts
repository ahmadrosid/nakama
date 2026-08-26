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
});
