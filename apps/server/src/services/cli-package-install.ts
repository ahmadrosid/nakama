import { getToolExecutionEnv } from "../lib/ensure-process-path";

export const CLI_SIGTERM_GRACE_MS = 2000;

const CLI_INSTALL_TIMEOUT_MS = 120_000;

/**
 * Upper bound on waiting for a timed-out child to actually exit. The escalation
 * normally lands long before this; the bound only keeps a caller from waiting
 * forever on a process no signal can reach.
 */
const CLI_SETTLE_TIMEOUT_MS = 5000;

export interface GlobalPackageInstallPlan {
  args: string[];
  command: string;
  displayCommand: string;
}

export function detectNpmOrBun(): "npm" | "bun" {
  if (Bun.which("npm")) {
    return "npm";
  }

  if (Bun.which("bun")) {
    return "bun";
  }

  return "npm";
}

export function buildGlobalPackageInstallPlan(
  packageName: string,
  packageManager: "npm" | "bun" = detectNpmOrBun()
): GlobalPackageInstallPlan {
  if (packageManager === "bun") {
    return {
      args: ["install", "-g", "--trust", packageName],
      command: "bun",
      displayCommand: `bun install -g --trust ${packageName}`,
    };
  }

  return {
    args: ["install", "-g", packageName],
    command: "npm",
    displayCommand: `npm install -g ${packageName}`,
  };
}

function extractCliVersion(stdout: string, stderr: string): string | null {
  const output = `${stdout}\n${stderr}`.trim();
  if (!output) {
    return null;
  }

  return output.split(/\r?\n/, 1)[0]?.trim() || null;
}

export function summarizeInstallOutput(output: string): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const meaningful =
    lines.find((line) => /^error:/i.test(line)) ??
    lines.find((line) =>
      /(?:EACCES|ENOENT|EPERM|failed|permission denied)/i.test(line)
    ) ??
    lines.find((line) => !/^bun (?:add|install) v/i.test(line)) ??
    lines[0] ??
    output.trim();
  return meaningful.length > 180
    ? `${meaningful.slice(0, 177)}...`
    : meaningful;
}

export async function probeCliVersion(command: string): Promise<{
  installed: boolean;
  version: string | null;
  missing: boolean;
}> {
  const { spawn } = await import("node:child_process");
  const timeoutMs = 5000;

  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;

    try {
      child = spawn(command, ["--version"], {
        env: getToolExecutionEnv(),
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      resolve({
        installed: false,
        missing: true,
        version: null,
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    let killTimeoutId: ReturnType<typeof setTimeout> | undefined;

    const timeoutId = setTimeout(() => {
      child.kill("SIGTERM");
      killTimeoutId = setTimeout(
        () => child.kill("SIGKILL"),
        CLI_SIGTERM_GRACE_MS
      );
      resolve({ installed: false, missing: false, version: null });
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => {
      clearTimeout(timeoutId);
      clearTimeout(killTimeoutId);
      resolve({
        installed: false,
        missing: (error as NodeJS.ErrnoException).code === "ENOENT",
        version: null,
      });
    });
    child.once("close", (code) => {
      clearTimeout(timeoutId);
      clearTimeout(killTimeoutId);
      resolve({
        installed: code === 0,
        missing: false,
        version: code === 0 ? extractCliVersion(stdout, stderr) : null,
      });
    });
  });
}

export async function runTimedInstallCommand(
  plan: GlobalPackageInstallPlan,
  onProgress?: (message: string) => void,
  options: {
    settleTimeoutMs?: number;
    sigtermGraceMs?: number;
    timeoutMs?: number;
  } = {}
): Promise<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}> {
  const { spawn } = await import("node:child_process");
  const timeoutMs = options.timeoutMs ?? CLI_INSTALL_TIMEOUT_MS;
  const sigtermGraceMs = options.sigtermGraceMs ?? CLI_SIGTERM_GRACE_MS;
  const settleTimeoutMs = options.settleTimeoutMs ?? CLI_SETTLE_TIMEOUT_MS;

  return new Promise((resolve) => {
    const child = spawn(plan.command, plan.args, {
      env: getToolExecutionEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let exited = false;
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let killTimeoutId: ReturnType<typeof setTimeout> | undefined;
    let settleTimeoutId: ReturnType<typeof setTimeout> | undefined;

    const clearTimers = () => {
      clearTimeout(timeoutId);
      clearTimeout(killTimeoutId);
      clearTimeout(settleTimeoutId);
    };

    /**
     * Resolving here means the deadline passed, so the exit code is not the
     * installer's own. Waiting for the child's `exit` first is what makes the
     * result honest: it is reported once the process is gone, not once the
     * signal was sent.
     */
    const settleAsTimedOut = () => {
      clearTimers();
      resolve({
        exitCode: null,
        stderr: stderr.trim(),
        stdout: stdout.trim(),
        timedOut,
      });
    };

    const timeoutId = setTimeout(() => {
      timedOut = true;

      // The process can already be gone with `close` still outstanding, held by
      // whatever the installer left running. There is nothing left to wait for.
      if (exited) {
        settleAsTimedOut();
        return;
      }

      child.kill("SIGTERM");
      killTimeoutId = setTimeout(() => child.kill("SIGKILL"), sigtermGraceMs);
      settleTimeoutId = setTimeout(settleAsTimedOut, settleTimeoutMs);
    }, timeoutMs);

    const emitLine = (prefix: "stdout" | "stderr", line: string) => {
      if (timedOut) {
        return;
      }

      onProgress?.(`${prefix}: ${line}`);
    };

    const flushBuffer = (buffer: string, prefix: "stdout" | "stderr") => {
      let nextBuffer = buffer;

      while (true) {
        const newlineIndex = nextBuffer.search(/\r?\n/);

        if (newlineIndex < 0) {
          break;
        }

        const newlineLength = nextBuffer[newlineIndex] === "\r" ? 2 : 1;
        const line = nextBuffer.slice(0, newlineIndex).trim();
        nextBuffer = nextBuffer.slice(newlineIndex + newlineLength);

        if (line) {
          emitLine(prefix, line);
        }
      }

      return nextBuffer;
    };

    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      stdoutBuffer += text;
      stdoutBuffer = flushBuffer(stdoutBuffer, "stdout");
    });
    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      stderrBuffer += text;
      stderrBuffer = flushBuffer(stderrBuffer, "stderr");
    });

    /**
     * `close` waits for the stdio pipes, which anything the installer left
     * running can hold open indefinitely, so it is not a usable signal for a
     * run that has already timed out. `exit` fires when the process itself is
     * gone, which is the question the timeout path is asking.
     */
    child.once("exit", () => {
      exited = true;

      if (timedOut) {
        settleAsTimedOut();
      }
    });

    child.once("error", (error) => {
      clearTimers();

      if (stdoutBuffer.trim()) {
        emitLine("stdout", stdoutBuffer.trim());
      }
      if (stderrBuffer.trim()) {
        emitLine("stderr", stderrBuffer.trim());
      }

      resolve({
        exitCode: null,
        stderr: `${stderr}\n${String(error)}`.trim(),
        stdout,
        timedOut,
      });
    });

    child.once("close", (exitCode) => {
      clearTimers();

      if (stdoutBuffer.trim()) {
        emitLine("stdout", stdoutBuffer.trim());
      }
      if (stderrBuffer.trim()) {
        emitLine("stderr", stderrBuffer.trim());
      }

      resolve({
        exitCode,
        stderr: stderr.trim(),
        stdout: stdout.trim(),
        timedOut,
      });
    });
  });
}
