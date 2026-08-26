import { describe, expect, test } from "bun:test";
import { runTimedInstallCommand } from "./cli-package-install";

const SLOW_PLAN = {
  args: ["-c", "printf partial; exec sleep 5"],
  command: "sh",
  displayCommand: "sh -c 'printf partial; exec sleep 5'",
};

describe("runTimedInstallCommand", () => {
  test("gives up on an installer that outlives the timeout", async () => {
    const result = await runTimedInstallCommand(SLOW_PLAN, undefined, {
      timeoutMs: 50,
    });

    expect(result.timedOut).toBe(true);
  });

  test("stops reporting progress once the timeout has resolved", async () => {
    const late: string[] = [];
    let settled = false;

    await runTimedInstallCommand(
      SLOW_PLAN,
      (message) => {
        if (settled) {
          late.push(message);
        }
      },
      { timeoutMs: 50 }
    );
    settled = true;

    await new Promise((resolve) => setTimeout(resolve, 500));

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
