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
