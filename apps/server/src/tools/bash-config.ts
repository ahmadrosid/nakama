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

/**
 * Whether the host-shell `bash` tool may be attached to tenant profiles.
 *
 * Off by default: an org admin chats with the org Super Bot, so a seeded or
 * self-assigned `bash` tool would hand that tenant a shell running as the
 * Nakama server process — the server config, every other org's profile
 * workspace, and its network. Turning this on is a deployment decision
 * (`NAKAMA_TENANT_BASH`), not something an org admin can grant itself.
 */
export function isTenantBashEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const raw = env.NAKAMA_TENANT_BASH?.trim();
  if (!raw) {
    return false;
  }

  const normalized = raw.toLowerCase();
  if (normalized === "0" || normalized === "false" || normalized === "off") {
    return false;
  }

  if (normalized === "1" || normalized === "true" || normalized === "on") {
    return true;
  }

  throw new Error(
    `Invalid NAKAMA_TENANT_BASH="${raw}". Use "1" to enable or "0" to keep the tenant bash tool disabled.`
  );
}
