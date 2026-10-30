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
}

export interface AcpAgentProcess {
  connection: acp.ClientContext;
  /** Resolves when the agent process exits, for any reason. */
  exited: Promise<void>;
  kill(): void;
}

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
      stdio: ["pipe", "pipe", "pipe"],
    }
  );

  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.once("error", () => resolve());
  });

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
    child.kill();
    throw error;
  }

  return {
    connection,
    exited,
    kill: () => {
      child.kill();
    },
  };
}
