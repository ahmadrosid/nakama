import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  test("preserves UTF-8 characters split across stdout and stderr chunks", async () => {
    const progress: string[] = [];
    const result = await runTimedInstallCommand(
      {
        args: [
          "-e",
          `
          process.stdout.write(Buffer.from([0xf0, 0x9f]));
          process.stderr.write(Buffer.from([0xe2]));
          await Bun.sleep(100);
          process.stdout.write(Buffer.from([0x9a, 0x80, 0x0a]));
          process.stderr.write(Buffer.from([0x82, 0xac]));
          `,
        ],
        command: process.execPath,
        displayCommand: "split UTF-8 output",
      },
      (message) => progress.push(message)
    );

    expect(result).toEqual({
      exitCode: 0,
      stderr: "\u20ac",
      stdout: "\ud83d\ude80",
      timedOut: false,
    });
    expect(progress).toEqual(["stdout: \ud83d\ude80", "stderr: \u20ac"]);
  });

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

  // The two SIGTERM_IGNORING_PLAN tests are POSIX-only: Windows has no SIGTERM
  // to trap, so the first kill step already force-kills the tree there.
  test.skipIf(process.platform === "win32")(
    "settles only once the timed-out installer has actually exited",
    async () => {
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
    }
  );

  test.skipIf(process.platform === "win32")(
    "gives up waiting when the kill escalation has not landed yet",
    async () => {
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
    }
  );
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

  /**
   * The installer shells out and the grandchild outlives its parent. A kill
   * aimed at the direct child leaves that grandchild running, which is what
   * "the timeout does not cancel the install" meant in practice.
   *
   * POSIX-only: under Git Bash the `&` child is not a Windows child of the
   * sh.exe spawned here (MSYS fork re-parents it to a short-lived helper), so
   * no tree kill can reach it. The `.cmd` shim test below covers Windows.
   */
  test.skipIf(process.platform === "win32")(
    "a timed-out install stops the processes it started, not just the one it spawned",
    async () => {
      const marker = join(tmpdir(), `nakama-install-grandchild-${Date.now()}`);
      rmSync(marker, { force: true });

      const result = await runTimedInstallCommand(
        {
          args: [
            "-c",
            `sh -c 'sleep 1.2; echo alive > ${marker}' & echo started; wait`,
          ],
          command: "sh",
          displayCommand: "sh -c 'grandchild'",
        },
        undefined,
        { settleTimeoutMs: 1000, sigtermGraceMs: 100, timeoutMs: 200 }
      );

      expect(result.timedOut).toBe(true);

      // Past the grandchild's own sleep: if the group was signalled it never
      // wrote, and if only the direct child was signalled it has by now.
      await Bun.sleep(1600);
      const survived = existsSync(marker);
      rmSync(marker, { force: true });
      expect(survived).toBe(false);
    },
    15_000
  );

  /**
   * A global npm install on Windows runs through a `.cmd` shim: cmd.exe with
   * node.exe under it. Ending cmd.exe alone leaves node.exe running.
   */
  test.skipIf(process.platform !== "win32")(
    "a stopped install on Windows ends the node process under a .cmd shim",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "nakama-install-shim-"));
      const marker = join(dir, "alive");
      const grandchild = join(dir, "grandchild.js");
      const shim = join(dir, "installer.cmd");
      writeFileSync(
        grandchild,
        `console.log("started");\nsetTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, "alive"), 1500);\n`
      );
      writeFileSync(
        shim,
        `@echo off\r\n"${process.execPath}" "${grandchild}"\r\n`
      );
      const controller = new AbortController();

      try {
        const result = await runTimedInstallCommand(
          {
            args: ["/d", "/c", shim],
            command: "cmd.exe",
            displayCommand: "installer.cmd",
          },
          (message) => {
            // Stop only once node.exe is running, or there is nothing to prove.
            if (message === "stdout: started") {
              controller.abort();
            }
          },
          {
            settleTimeoutMs: 1000,
            signal: controller.signal,
            timeoutMs: 30_000,
          }
        );

        expect(result.timedOut).toBe(true);
        // Past the grandchild's own timer: had it survived, it has written.
        await Bun.sleep(2500);
        expect(existsSync(marker)).toBe(false);
      } finally {
        rmSync(dir, { force: true, recursive: true });
      }
    },
    15_000
  );

  test("an aborted signal ends the install without waiting for the deadline", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);

    const startedAt = Date.now();
    const result = await runTimedInstallCommand(STALLING_PLAN, undefined, {
      settleTimeoutMs: 1000,
      signal: controller.signal,
      sigtermGraceMs: 100,
      timeoutMs: 60_000,
    });

    // The 60s deadline never fired, so finishing at all is the abort working.
    expect(result.timedOut).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(10_000);
  }, 15_000);
});
