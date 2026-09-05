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
