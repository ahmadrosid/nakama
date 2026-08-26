import { getToolExecutionEnv } from "../lib/ensure-process-path";

export const CLI_SIGTERM_GRACE_MS = 2000;

const CLI_INSTALL_TIMEOUT_MS = 120_000;

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
  options: { timeoutMs?: number } = {}
): Promise<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}> {
  const { spawn } = await import("node:child_process");
  const timeoutMs = options.timeoutMs ?? CLI_INSTALL_TIMEOUT_MS;

  return new Promise((resolve) => {
    const child = spawn(plan.command, plan.args, {
      env: getToolExecutionEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let killTimeoutId: ReturnType<typeof setTimeout> | undefined;
    let settled = false;

    const settle = (value: {
      exitCode: number | null;
      stdout: string;
      stderr: string;
      timedOut: boolean;
    }) => {
      settled = true;
      resolve(value);
    };

    const timeoutId = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      killTimeoutId = setTimeout(
        () => child.kill("SIGKILL"),
        CLI_SIGTERM_GRACE_MS
      );
      settle({
        exitCode: null,
        stderr: stderr.trim(),
        stdout: stdout.trim(),
        timedOut,
      });
    }, timeoutMs);

    const emitLine = (prefix: "stdout" | "stderr", line: string) => {
      if (settled) {
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

    child.once("error", (error) => {
      clearTimeout(timeoutId);
      clearTimeout(killTimeoutId);

      if (stdoutBuffer.trim()) {
        emitLine("stdout", stdoutBuffer.trim());
      }
      if (stderrBuffer.trim()) {
        emitLine("stderr", stderrBuffer.trim());
      }

      settle({
        exitCode: null,
        stderr: `${stderr}\n${String(error)}`.trim(),
        stdout,
        timedOut,
      });
    });

    child.once("close", (exitCode) => {
      clearTimeout(timeoutId);
      clearTimeout(killTimeoutId);

      if (stdoutBuffer.trim()) {
        emitLine("stdout", stdoutBuffer.trim());
      }
      if (stderrBuffer.trim()) {
        emitLine("stderr", stderrBuffer.trim());
      }

      settle({
        exitCode,
        stderr: stderr.trim(),
        stdout: stdout.trim(),
        timedOut,
      });
    });
  });
}
