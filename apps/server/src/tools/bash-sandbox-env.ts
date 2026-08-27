const SECRET_ENV_KEY =
  /(?:^|_)(KEY|TOKEN|SECRET|PASSWORD|API[_-]?KEY|ACCESS[_-]?KEY[_-]?ID|CREDENTIALS?)$/i;

const PROVIDER_SECRET_KEYS = new Set(
  [
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GOOGLE_API_KEY",
    "GEMINI_API_KEY",
    "OPENROUTER_API_KEY",
    "AZURE_OPENAI_API_KEY",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "DATABASE_URL",
    "POSTGRES_URL",
    "MYSQL_URL",
    "REDIS_URL",
    "MYSQL_PWD",
    "PGPASSWORD",
    "GOOGLE_APPLICATION_CREDENTIALS",
  ].map((key) => key.toUpperCase())
);

export function isSecretEnvKey(key: string): boolean {
  const upper = key.toUpperCase();
  if (PROVIDER_SECRET_KEYS.has(upper)) {
    return true;
  }
  if (SECRET_ENV_KEY.test(key)) {
    return true;
  }
  // Connection-string style vars often embed credentials.
  return /_URL$/i.test(key);
}

/**
 * Env for microsandbox bash runs: small allowlist base ∪ tool overrides,
 * then strip secret-shaped keys (including overrides).
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

  if (host.PATH) {
    env.PATH = host.PATH;
  }
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

  for (const key of Object.keys(env)) {
    if (isSecretEnvKey(key)) {
      delete env[key];
    }
  }

  return env;
}
