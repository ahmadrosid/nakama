export type BashBackendKind = "host" | "microsandbox";

export type BashSandboxNetwork = "off" | "public";

const DEFAULT_SANDBOX_IMAGE = "alpine";

export function resolveBashBackend(
  env: NodeJS.ProcessEnv = process.env
): BashBackendKind {
  const raw = env.NAKAMA_BASH_BACKEND?.trim();

  if (!raw) {
    return "host";
  }

  const normalized = raw.toLowerCase();

  if (normalized === "host" || normalized === "microsandbox") {
    return normalized;
  }

  throw new Error(
    `Invalid NAKAMA_BASH_BACKEND="${raw}". Use "host" or "microsandbox".`
  );
}

export function resolveBashSandboxNetwork(
  env: NodeJS.ProcessEnv = process.env
): BashSandboxNetwork {
  const raw = env.NAKAMA_BASH_SANDBOX_NETWORK?.trim();

  if (!raw) {
    return "off";
  }

  const normalized = raw.toLowerCase();

  if (normalized === "off" || normalized === "public") {
    return normalized;
  }

  return "off";
}

export function resolveBashSandboxImage(
  env: NodeJS.ProcessEnv = process.env
): string {
  const raw = env.NAKAMA_BASH_SANDBOX_IMAGE?.trim();

  return raw || DEFAULT_SANDBOX_IMAGE;
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
