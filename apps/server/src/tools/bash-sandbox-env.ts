const SECRET_ENV_KEY =
  /(?:^|_)(KEY|TOKEN|SECRET|PASSWORD|PWD|API[_-]?KEY|ACCESS[_-]?KEY[_-]?ID|CREDENTIALS?)$/i;

function isSecretEnvKey(key: string): boolean {
  return SECRET_ENV_KEY.test(key) || /_URL$/i.test(key);
}

/**
 * Env for microsandbox bash runs: small allowlist base ∪ tool overrides,
 * then strip secret-shaped keys (including overrides).
 *
 * Does not copy host PATH — the guest image keeps its own default.
 *
 * `workspaceRoot` must be the **guest** workspace path (e.g. `/workspace`),
 * not the host soul directory.
 */
export function buildBashSandboxEnv(args: {
  hostEnv?: NodeJS.ProcessEnv;
  overrides?: Record<string, string>;
  workspaceRoot?: string;
}): Record<string, string> {
  const host = args.hostEnv ?? process.env;
  const env: Record<string, string> = {};

  // Do not copy host PATH — guest images (alpine / bun slim) have their own,
  // and macOS/dev host paths do not exist inside the microVM.
  if (host.LANG) {
    env.LANG = host.LANG;
  }
  if (args.workspaceRoot) {
    env.NAKAMA_WORKSPACE_ROOT = args.workspaceRoot;
    env.HOME = args.workspaceRoot;
  }

  for (const [key, value] of Object.entries(args.overrides ?? {})) {
    if (!isSecretEnvKey(key)) {
      env[key] = value;
    }
  }

  return env;
}
