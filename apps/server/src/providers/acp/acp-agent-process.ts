import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import { isSecretEnvKey } from "@nakama/core";

export interface AcpAgentLaunch {
  args: string[];
  command: string;
  cwd: string;
  /** Extra variables for the agent process. Merged over the server environment. */
  env?: NodeJS.ProcessEnv;
  /** Run through the system shell, for Windows `.cmd` / `.bat` shims. */
  shell?: boolean;
}

export interface AcpAgentProcess {
  connection: acp.ClientContext;
  /** Resolves when the agent process exits, for any reason. */
  exited: Promise<void>;
  kill(): void;
}

const STDERR_TAIL_CHARS = 2000;

/** How long a failed agent gets to stop before SIGKILL, and SIGKILL to land. */
const STOP_TIMEOUT_MS = 2000;

// The agent logs in with its own keys (ANTHROPIC_API_KEY, OPENAI_API_KEY), so only
// Nakama's own secrets are cut, not every key-shaped variable.
function agentEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !(key.startsWith("NAKAMA_") && isSecretEnvKey(key))
    )
  );
}

/**
 * Starts an ACP agent as a child process that speaks JSON-RPC over stdio, then
 * runs `initialize`. Nakama never gives the agent file or terminal access:
 * the agent works in its own cwd, and Nakama tools arrive over MCP.
 */
export async function startAcpAgentProcess(
  launch: AcpAgentLaunch,
  app: acp.ClientApp
): Promise<AcpAgentProcess> {
  const child: ChildProcessWithoutNullStreams = spawn(
    launch.command,
    launch.args,
    {
      cwd: launch.cwd,
      env: { ...agentEnv(), ...launch.env },
      shell: launch.shell ?? false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    }
  );

  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.once("error", () => resolve());
  });

  // "close" comes after the last stdio data, so the stderr tail is complete.
  const closed = new Promise<void>((resolve) => {
    child.once("close", () => resolve());
    child.once("error", () => resolve());
  });

  // Keep the end of stderr, so a start failure says why the agent stopped.
  let stderrTail = "";

  const keepStderrTail = (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-STDERR_TAIL_CHARS);
  };

  child.stderr.on("data", keepStderrTail);

  // SAFETY: Node's byte stream implements the SDK's DOM stream contract; only reader overload declarations differ.
  const stdout = Readable.toWeb(child.stdout) as ReturnType<
    typeof Readable.toWeb
  > &
    ReadableStream<Uint8Array>;

  const stream = acp.ndJsonStream(Writable.toWeb(child.stdin), stdout);

  const connection = app.connect(stream).agent;

  try {
    await connection.request(acp.methods.agent.initialize, {
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
      protocolVersion: acp.PROTOCOL_VERSION,
    });
  } catch (error) {
    killAgent(child);

    if (!(await settlesWithin(closed, STOP_TIMEOUT_MS))) {
      child.kill("SIGKILL");
      await settlesWithin(closed, STOP_TIMEOUT_MS);
    }

    throw new Error(
      `${[launch.command, ...launch.args].join(" ")} did not start an ACP agent. ${Bun.stripANSI(stderrTail).trim() || String(error)}`,
      { cause: error }
    );
  }

  // The tail is only for start errors. Keep draining stderr, stop keeping it.
  child.stderr.off("data", keepStderrTail);
  child.stderr.resume();

  return {
    connection,
    exited,
    kill: () => {
      killAgent(child);
    },
  };
}

async function settlesWithin(
  promise: Promise<void>,
  ms: number
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });

  try {
    return await Promise.race([promise.then(() => true), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * On Windows the child can be `cmd.exe` (a `.cmd` shim) or a launcher, and
 * `kill()` stops only that process. taskkill /T stops the whole tree.
 */
function killAgent(child: ChildProcessWithoutNullStreams): void {
  if (process.platform === "win32" && child.pid !== undefined) {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    }).once("error", () => child.kill());

    return;
  }

  child.kill();
}
