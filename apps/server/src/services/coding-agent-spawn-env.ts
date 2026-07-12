import type { StoredCodingAgentHarnessKind } from "@nakama/db";

export interface CodingAgentSpawnEnvOptions {
  model?: string | null;
  gatewayBaseUrl?: string | null;
  authToken?: string | null;
  orgId?: string | null;
  profileId?: string | null;
}

export function normalizeCodingAgentModel(model: string | null | undefined): string | null {
  if (!model?.trim()) {
    return null;
  }

  const trimmed = model.trim();
  const colonIndex = trimmed.indexOf(":");

  if (colonIndex >= 0) {
    const normalized = trimmed.slice(colonIndex + 1).trim();
    return normalized || null;
  }

  const slashIndex = trimmed.lastIndexOf("/");

  if (slashIndex >= 0) {
    const normalized = trimmed.slice(slashIndex + 1).trim();
    return normalized || null;
  }

  return trimmed;
}

export function buildClaudeCodeSpawnEnv(
  options: CodingAgentSpawnEnvOptions,
): Record<string, string> {
  const gatewayBaseUrl = options.gatewayBaseUrl?.trim();

  if (!gatewayBaseUrl) {
    return {};
  }

  const model = normalizeCodingAgentModel(options.model) ?? "claude-sonnet-4-6";
  const authToken = options.authToken?.trim();

  if (!authToken) {
    throw new Error(
      "Inference gateway is enabled but no local Nakama auth token is available for Claude Code.",
    );
  }

  const customHeaders = buildAnthropicCustomHeaders(options.orgId, options.profileId);

  return {
    ANTHROPIC_BASE_URL: gatewayBaseUrl.replace(/\/$/, ""),
    ANTHROPIC_API_KEY: "",
    ANTHROPIC_AUTH_TOKEN: authToken,
    ...(customHeaders ? { ANTHROPIC_CUSTOM_HEADERS: customHeaders } : {}),
    ANTHROPIC_DEFAULT_OPUS_MODEL: model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
    CLAUDE_CODE_SUBAGENT_MODEL: model,
    CLAUDE_CODE_ATTRIBUTION_HEADER: "0",
    DISABLE_TELEMETRY: "1",
    DISABLE_ERROR_REPORTING: "1",
    DISABLE_FEEDBACK_COMMAND: "1",
    CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: "1",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  };
}

export function buildCodexSpawnEnv(options: CodingAgentSpawnEnvOptions): Record<string, string> {
  const gatewayBaseUrl = options.gatewayBaseUrl?.trim();

  if (!gatewayBaseUrl) {
    return {};
  }

  const model = normalizeCodingAgentModel(options.model) ?? "gpt-4.1";

  return {
    OPENAI_API_KEY: "",
    OPENAI_BASE_URL: gatewayBaseUrl.replace(/\/$/, ""),
    OPENAI_MODEL: model,
  };
}

export function buildOpenCodeSpawnEnv(_options: CodingAgentSpawnEnvOptions): Record<string, string> {
  return {};
}

export function buildSpawnEnvForHarness(
  kind: StoredCodingAgentHarnessKind,
  options: CodingAgentSpawnEnvOptions,
): Record<string, string> {
  if (kind === "claude_code") {
    return buildClaudeCodeSpawnEnv(options);
  }

  if (kind === "codex") {
    return buildCodexSpawnEnv(options);
  }

  return buildOpenCodeSpawnEnv(options);
}

export function getInferenceGatewayBaseUrl(): string | null {
  if (process.env.NAKAMA_INFERENCE_GATEWAY_ENABLED !== "1") {
    return null;
  }

  const configured = process.env.NAKAMA_INFERENCE_GATEWAY_URL?.trim();

  if (configured) {
    return configured.replace(/\/$/, "");
  }

  const port = process.env.NAKAMA_PORT?.trim() || "4310";
  const publicUrl = process.env.NAKAMA_PUBLIC_URL?.trim();

  if (publicUrl) {
    return publicUrl.replace(/\/$/, "");
  }

  return `http://127.0.0.1:${port}`;
}

function buildAnthropicCustomHeaders(
  orgId?: string | null,
  profileId?: string | null,
): string | null {
  const headers: string[] = [];
  const trimmedOrgId = orgId?.trim();
  const trimmedProfileId = profileId?.trim();

  if (trimmedOrgId) {
    headers.push(`X-Org-Id: ${trimmedOrgId}`);
  }

  if (trimmedProfileId) {
    headers.push(`X-Nakama-Profile-Id: ${trimmedProfileId}`);
  }

  return headers.length > 0 ? headers.join("\n") : null;
}

export function mergeCodingAgentSpawnEnv(
  baseEnv: NodeJS.ProcessEnv,
  spawnEnv: Record<string, string>,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv, ...spawnEnv };

  for (const key of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"] as const) {
    if (key in spawnEnv && spawnEnv[key] === "") {
      delete env[key];
    }
  }

  return env;
}
