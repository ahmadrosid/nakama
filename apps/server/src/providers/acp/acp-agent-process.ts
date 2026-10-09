import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";

export interface AcpAgentLaunch {
  args: string[];
  command: string;
  cwd: string;
  /** Extra variables for the agent process. Merged over the server environment. */
  env?: NodeJS.ProcessEnv;
}

export interface AcpAgentProcess {
  connection: acp.ClientSideConnection;
  /** Resolves when the agent process exits, for any reason. */
  exited: Promise<void>;
  kill(): void;
}

/**
 * Starts an ACP agent as a child process that speaks JSON-RPC over stdio, then
 * runs `initialize`. Nakama never gives the agent file or terminal access:
 * the agent works in its own cwd, and Nakama tools arrive over MCP.
 */
export async function startAcpAgentProcess(
  launch: AcpAgentLaunch,
  client: acp.Client
): Promise<AcpAgentProcess> {
  const child: ChildProcessWithoutNullStreams = spawn(
    launch.command,
    launch.args,
    {
      cwd: launch.cwd,
      env: { ...process.env, ...launch.env },
      stdio: ["pipe", "pipe", "pipe"],
    }
  );

  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.once("error", () => resolve());
  });

  // SAFETY: Node's Readable.toWeb yields ReadableStream<any>, and the ACP
  // stream only reads Uint8Array chunks from the child's stdout.
  const stdout = Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>;
  const stream = acp.ndJsonStream(Writable.toWeb(child.stdin), stdout);

  const connection = new acp.ClientSideConnection(() => client, stream);

  try {
    await connection.initialize({
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
