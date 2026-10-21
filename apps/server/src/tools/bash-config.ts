export type BashBackendKind = "host" | "remote";

export type BashSandboxNetwork = "off" | "public";

export function resolveBashBackend(
  env: NodeJS.ProcessEnv = process.env
): BashBackendKind {
  const raw = env.NAKAMA_BASH_BACKEND?.trim().toLowerCase();

  if (!raw || raw === "host") {
    return "host";
  }

  if (raw === "remote") {
    return raw;
  }

  throw new Error(
    `Invalid NAKAMA_BASH_BACKEND="${env.NAKAMA_BASH_BACKEND}". Use "host" or "remote".`
  );
}

/** Off unless the operator opts in; only the remote backend reads it. */
export function resolveBashSandboxNetwork(
  env: NodeJS.ProcessEnv = process.env
): BashSandboxNetwork {
  const raw = env.NAKAMA_BASH_SANDBOX_NETWORK?.trim().toLowerCase();

  if (!raw || raw === "off") {
    return "off";
  }

  if (raw === "public") {
    return raw;
  }

  throw new Error(
    `Invalid NAKAMA_BASH_SANDBOX_NETWORK="${env.NAKAMA_BASH_SANDBOX_NETWORK}". Use "off" or "public".`
  );
}

export const TENANT_BASH_DISABLED =
  "The bash tool is turned off on this server (NAKAMA_TENANT_BASH=0).";

/**
 * On by default. A deployment where org admins are not the operator sets
 * NAKAMA_TENANT_BASH=0, because bash runs as the server process and reaches
 * config.ini, every org's workspace and the server network.
 */
export function isTenantBashEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const raw = env.NAKAMA_TENANT_BASH?.trim().toLowerCase();

  if (!raw || raw === "1" || raw === "true" || raw === "on") {
    return true;
  }

  if (raw === "0" || raw === "false" || raw === "off") {
    return false;
  }

  throw new Error(
    `Invalid NAKAMA_TENANT_BASH="${env.NAKAMA_TENANT_BASH}". Use "0" to turn the bash tool off for org profiles.`
  );
}
