import { readFile } from "node:fs/promises";
import type { ProviderInstance } from "@nakama/core";
import type { CodingAgentProviderRouting } from "./coding-agent-provider-routing";

export async function withFastCliProbes<T>(run: () => Promise<T>): Promise<T> {
  const previous = {
    grace: process.env.NAKAMA_CLI_SIGTERM_GRACE_MS,
    timeout: process.env.NAKAMA_CLI_PROBE_TIMEOUT_MS,
  };
  process.env.NAKAMA_CLI_PROBE_TIMEOUT_MS = "1000";
  process.env.NAKAMA_CLI_SIGTERM_GRACE_MS = "100";
  try {
    return await run();
  } finally {
    if (previous.timeout === undefined) {
      delete process.env.NAKAMA_CLI_PROBE_TIMEOUT_MS;
    } else {
      process.env.NAKAMA_CLI_PROBE_TIMEOUT_MS = previous.timeout;
    }
    if (previous.grace === undefined) {
      delete process.env.NAKAMA_CLI_SIGTERM_GRACE_MS;
    } else {
      process.env.NAKAMA_CLI_SIGTERM_GRACE_MS = previous.grace;
    }
  }
}

export async function waitForPidFile(
  pidFile: string,
  timeoutMs: number
): Promise<number> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const pid = Number.parseInt(await readFile(pidFile, "utf8"), 10);
      if (Number.isInteger(pid)) {
        return pid;
      }
    } catch {
      // Child has not written the pid yet.
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error(`pid file was not written: ${pidFile}`);
}

export async function waitForExit(
  pid: number,
  timeoutMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return false;
}

export function inactiveRouting(): CodingAgentProviderRouting {
  return {
    active: false,
    apiKey: null,
    baseUrl: null,
    compatible: false,
    configured: false,
    error: null,
    model: null,
    providerLabel: null,
    providerType: null,
  };
}

export function activeAnthropicRouting(
  overrides: Partial<CodingAgentProviderRouting> = {}
): CodingAgentProviderRouting {
  return {
    active: true,
    apiKey: "sk-ant-test",
    baseUrl: "https://api.anthropic.com",
    compatible: true,
    configured: true,
    error: null,
    model: "claude-sonnet-4-6",
    providerLabel: "Anthropic",
    providerType: "anthropic",
    ...overrides,
  };
}

export function makeAnthropicProvider(
  overrides: Partial<ProviderInstance> = {}
): ProviderInstance {
  return {
    apiKey: "sk-ant-test",
    createdAt: "2026-01-01T00:00:00.000Z",
    id: "prov_anthropic",
    label: "Anthropic",
    type: "anthropic",
    ...overrides,
  };
}

export function makeOpenAIProvider(
  overrides: Partial<ProviderInstance> = {}
): ProviderInstance {
  return {
    apiKey: "sk-openai-test",
    createdAt: "2026-01-01T00:00:00.000Z",
    id: "prov_openai",
    label: "OpenAI",
    type: "openai",
    ...overrides,
  };
}
