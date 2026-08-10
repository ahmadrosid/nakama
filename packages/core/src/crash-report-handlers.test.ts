import { expect, test } from "bun:test";
import { join } from "node:path";

const MODULE = join(import.meta.dir, "crash-report.ts");

/**
 * The handlers call process.exit, so they cannot be exercised in-process: a passing
 * assertion would take the test runner down with it. Each case runs in a real bun
 * process and is judged on what an operator would actually see, the stderr line and
 * the exit code.
 */
async function runCrashingProcess(body: string): Promise<{
  exitCode: number;
  stderr: string;
}> {
  const child = Bun.spawn(
    [
      "bun",
      "-e",
      `import { installCrashHandlers } from ${JSON.stringify(MODULE)};
installCrashHandlers("worker:demo");
${body}
setTimeout(() => {}, 5000);`,
    ],
    { stderr: "pipe", stdout: "pipe" }
  );

  const stderr = await new Response(child.stderr).text();

  return { exitCode: await child.exited, stderr };
}

test("an uncaught exception is logged with a fingerprint and exits non-zero", async () => {
  const { exitCode, stderr } = await runCrashingProcess(
    `setTimeout(() => {
      throw new Error("worker lost its connection");
    }, 0);`
  );

  expect(exitCode).toBe(1);
  expect(stderr).toContain("[nakama:crash] worker:demo");
  expect(stderr).toContain("worker lost its connection");
});

test("an unhandled rejection is reported the same way", async () => {
  const { exitCode, stderr } = await runCrashingProcess(
    `Promise.reject(new Error("nobody awaited this"));`
  );

  expect(exitCode).toBe(1);
  expect(stderr).toContain("[nakama:crash] worker:demo");
  expect(stderr).toContain("nobody awaited this");
});

test("the same bug in two runs reports the same fingerprint", async () => {
  const crash = `setTimeout(() => {
    throw new Error("worker lost its connection");
  }, 0);`;
  const first = await runCrashingProcess(crash);
  const second = await runCrashingProcess(crash);

  const fingerprint = (stderr: string) =>
    stderr.match(/\[nakama:crash\] worker:demo (\w{16})/)?.[1];

  expect(fingerprint(first.stderr)).toBeDefined();
  expect(fingerprint(first.stderr)).toBe(fingerprint(second.stderr));
});
