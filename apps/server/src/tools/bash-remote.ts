import path from "node:path";
import { z } from "zod";
import type { BashOutput } from "./bash";
import { resolveBashSandboxNetwork } from "./bash-config";

const REMOTE_WORKSPACE = "/workspace";

const MAX_OUTPUT_CHARS = 32_000;

/** Time the service gets past `timeoutMs` to send back partial output. */
const DEADLINE_GRACE_MS = 10_000;

const SECRET_ENV_KEY =
  /(?:^|_)(KEY|TOKEN|SECRET|PASSWORD|PWD|AUTH|COOKIE|API[_-]?KEY|ACCESS[_-]?KEY[_-]?ID|CREDENTIALS?)$/i;

const remoteOutputSchema = z.object({
  exitCode: z.number().nullable(),
  stderr: z.string(),
  stdout: z.string(),
  timedOut: z.boolean(),
});

export interface RemoteBashRequest {
  codingAgent: boolean;
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  orgId: string;
  profileId: string;
  signal?: AbortSignal;
  timeoutMs: number;
}

export function remoteBashDescription(
  env: NodeJS.ProcessEnv = process.env
): string {
  const network =
    resolveBashSandboxNetwork(env) === "public"
      ? "Public network is on."
      : "Network is off.";

  return `Commands run in a remote sandbox, not on this server. ${REMOTE_WORKSPACE} starts empty and does not share files with read_file, write_file, or edit_file. ${network} codingAgent runs are unsupported on this backend.`;
}

/**
 * NAKAMA_BASH_BACKEND=remote: POST the command to an operator-run sandbox
 * service. Fails closed; nothing here ever falls back to host bash.
 */
export async function runRemoteBash(
  request: RemoteBashRequest,
  env: NodeJS.ProcessEnv = process.env
): Promise<BashOutput> {
  request.signal?.throwIfAborted();

  if (request.codingAgent) {
    throw new Error(
      "codingAgent is unsupported when NAKAMA_BASH_BACKEND=remote. Use NAKAMA_BASH_BACKEND=host for coding-agent harness runs."
    );
  }

  const { token, url } = readRemoteConfig(env);
  const deadline = AbortSignal.timeout(request.timeoutMs + DEADLINE_GRACE_MS);

  const signal = request.signal
    ? AbortSignal.any([request.signal, deadline])
    : deadline;

  const payload = JSON.stringify({
    command: request.command,
    cwd: toRemoteCwd(request.cwd),
    // Only the tool call's own env, never process.env.
    env: Object.fromEntries(
      Object.entries(request.env ?? {}).filter(([key]) => !isSecretEnvKey(key))
    ),
    network: resolveBashSandboxNetwork(env),
    sandboxId: `nakama-${request.orgId}-${request.profileId}`,
    timeoutMs: request.timeoutMs,
  });

  let response: Response;
  let output: z.infer<typeof remoteOutputSchema> | undefined;

  try {
    response = await fetch(url, {
      body: payload,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      signal,
    });
    output = response.ok
      ? remoteOutputSchema.safeParse(await response.json()).data
      : undefined;
  } catch (error) {
    if (request.signal?.aborted) {
      throw new DOMException("The operation was aborted", "AbortError");
    }

    // The service never answered, so there is no partial output to return.
    if (deadline.aborted) {
      return { exitCode: null, stderr: "", stdout: "", timedOut: true };
    }

    throw new Error(
      `Remote bash service request failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error("Remote bash service rejected NAKAMA_BASH_REMOTE_TOKEN.");
  }

  if (!response.ok) {
    throw new Error(`Remote bash service returned HTTP ${response.status}.`);
  }

  if (!output) {
    throw new Error("Remote bash service returned an invalid response.");
  }

  return {
    exitCode: output.exitCode,
    stderr: truncate(output.stderr),
    stdout: truncate(output.stdout),
    timedOut: output.timedOut,
  };
}

function readRemoteConfig(env: NodeJS.ProcessEnv) {
  const rawUrl = env.NAKAMA_BASH_REMOTE_URL?.trim();
  const token = env.NAKAMA_BASH_REMOTE_TOKEN?.trim();

  if (!(rawUrl && token)) {
    throw new Error(
      "NAKAMA_BASH_BACKEND=remote needs NAKAMA_BASH_REMOTE_URL and NAKAMA_BASH_REMOTE_TOKEN."
    );
  }

  const url = URL.canParse(rawUrl) ? new URL(rawUrl) : null;

  if (!(url && (url.protocol === "https:" || url.protocol === "http:"))) {
    throw new Error("NAKAMA_BASH_REMOTE_URL must be an http(s) URL.");
  }

  return { token, url: url.href };
}

function isSecretEnvKey(key: string): boolean {
  return SECRET_ENV_KEY.test(key) || /_URL$/i.test(key);
}

function toRemoteCwd(rawCwd: string | undefined): string {
  const cwd = path.posix.resolve(
    REMOTE_WORKSPACE,
    rawCwd?.trim().replaceAll("\\", "/") || "."
  );

  if (cwd !== REMOTE_WORKSPACE && !cwd.startsWith(`${REMOTE_WORKSPACE}/`)) {
    throw new Error(`cwd must stay under ${REMOTE_WORKSPACE}.`);
  }

  return cwd;
}

function truncate(value: string): string {
  return value.length <= MAX_OUTPUT_CHARS
    ? value
    : `${value.slice(0, MAX_OUTPUT_CHARS)}\n...[truncated]`;
}
