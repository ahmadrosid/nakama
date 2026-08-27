const SECRET_ENV_KEY = /(?:^|_)(KEY|TOKEN|SECRET|PASSWORD|API[_-]?KEY)$/i;

const PROVIDER_SECRET_KEYS = new Set(
  [
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GOOGLE_API_KEY",
    "GEMINI_API_KEY",
    "OPENROUTER_API_KEY",
    "AZURE_OPENAI_API_KEY",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
  ].map((key) => key.toUpperCase())
);

export function isSecretEnvKey(key: string): boolean {
  const upper = key.toUpperCase();
  return PROVIDER_SECRET_KEYS.has(upper) || SECRET_ENV_KEY.test(key);
}

/**
 * Env for microsandbox bash runs: small allowlist base ∪ tool overrides,
 * then strip secret-shaped keys (including overrides).
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
  if (host.HOME) {
    env.HOME = host.HOME;
  }
  if (host.LANG) {
    env.LANG = host.LANG;
  }
  if (host.NAKAMA_CONFIG_DIR) {
    env.NAKAMA_CONFIG_DIR = host.NAKAMA_CONFIG_DIR;
  }
  if (args.workspaceRoot) {
    env.NAKAMA_WORKSPACE_ROOT = args.workspaceRoot;
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
