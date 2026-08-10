import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ProviderName } from "@nakama/core";
import type { StoredCodingAgentHarnessKind } from "@nakama/db";
import type { CodingAgentProviderRouting } from "./coding-agent-provider-routing";
import { formatModelForHarness } from "./coding-agent-spawn-env";

export interface HarnessConfigDir {
  cleanup: () => Promise<void>;
  dir: string;
}

export async function createHarnessConfigDir(
  prefix: string
): Promise<HarnessConfigDir> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  await chmod(dir, 0o700);

  return {
    cleanup: async () => {
      const { rm } = await import("node:fs/promises");
      await rm(dir, { force: true, recursive: true });
    },
    dir,
  };
}

export async function writeCodexConfigToml(
  configDir: string,
  routing: CodingAgentProviderRouting,
  harnessKind: StoredCodingAgentHarnessKind,
  providerType: ProviderName
): Promise<string> {
  const configPath = path.join(configDir, "config.toml");
  const model = formatModelForHarness(
    harnessKind,
    providerType,
    routing.model ?? "gpt-4.1"
  );
  const baseUrl = routing.baseUrl ?? "";
  const apiKey = routing.apiKey ?? "";

  const contents = [
    'model_provider = "nakama"',
    "",
    "[model_providers.nakama]",
    'name = "Nakama"',
    `base_url = "${baseUrl}"`,
    `wire_api = "responses"`,
    "",
    "[model_providers.nakama.env]",
    `OPENAI_API_KEY = "${apiKey.replace(/"/g, '\\"')}"`,
    "",
    "[profiles.nakama]",
    'model_provider = "nakama"',
    `model = "${model.replace(/"/g, '\\"')}"`,
    "",
  ].join("\n");

  await writeFile(configPath, contents, { mode: 0o600 });
  return configPath;
}

export async function writeOpenCodeConfig(
  configRoot: string,
  routing: CodingAgentProviderRouting,
  harnessKind: StoredCodingAgentHarnessKind,
  providerType: ProviderName
): Promise<string> {
  const configDir = path.join(configRoot, "opencode");
  await mkdir(configDir, { mode: 0o700, recursive: true });

  const configPath = path.join(configDir, "opencode.json");
  const model = routing.model
    ? formatModelForHarness(harnessKind, providerType, routing.model)
    : null;

  const providerKey = resolveOpenCodeProviderKey(providerType);
  const config = {
    $schema: "https://opencode.ai/config.json",
    provider: {
      [providerKey]: {
        options: {
          apiKey: routing.apiKey,
          baseURL: routing.baseUrl,
        },
        ...(model ? { models: { [model]: { name: model } } } : {}),
      },
    },
    ...(model ? { model: `${providerKey}/${model}` } : {}),
  };

  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(configPath, 0o600);
  return configPath;
}

function resolveOpenCodeProviderKey(providerType: ProviderName): string {
  if (providerType === "openrouter") {
    return "openrouter";
  }

  if (providerType === "openai") {
    return "openai";
  }

  if (providerType === "opencode_go") {
    return "opencode-go";
  }

  return "nakama";
}

/**
 * Maps a Nakama provider type to the pi CLI built-in provider ID.
 * pi has named providers (e.g. "openai", "anthropic", "openrouter") with
 * hardcoded base URLs. We override their baseUrl + apiKey via models.json.
 */
function resolvePiProviderId(providerType: ProviderName): string {
  if (providerType === "anthropic") {
    return "anthropic";
  }
  if (providerType === "openai") {
    return "openai";
  }
  if (providerType === "openrouter") {
    return "openrouter";
  }
  if (providerType === "deepseek") {
    return "deepseek";
  }
  if (providerType === "cerebras") {
    return "cerebras";
  }
  if (providerType === "fireworks") {
    return "fireworks";
  }
  if (providerType === "opencode_go") {
    return "opencode";
  }
  return "nakama";
}

/**
 * Default base URLs for built-in pi providers.
 * When the configured base URL matches the default, we can safely override
 * the built-in provider (which keeps the correct API type).
 * When it doesn't match (proxy/gateway), we create a custom "nakama" provider
 * with the OpenAI Chat Completions API, which is universally supported.
 */
const PI_DEFAULT_BASE_URLS: Partial<Record<ProviderName, string>> = {
  anthropic: "https://api.anthropic.com",
  cerebras: "https://api.cerebras.ai/v1",
  deepseek: "https://api.deepseek.com",
  fireworks: "https://api.fireworks.ai/inference",
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
};

function isDefaultBaseUrl(
  providerType: ProviderName,
  baseUrl: string | null | undefined
): boolean {
  if (!baseUrl) {
    return false;
  }
  const defaultUrl = PI_DEFAULT_BASE_URLS[providerType];
  if (!defaultUrl) {
    return false;
  }
  return baseUrl.replace(/\/+$/, "") === defaultUrl.replace(/\/+$/, "");
}

/**
 * Writes a models.json that routes pi requests through the Nakama-configured
 * provider.
 *
 * Strategy:
 * - If the base URL matches the built-in provider's default (e.g. real
 *   api.anthropic.com), override the built-in provider's baseUrl + apiKey.
 *   This keeps the provider's native API type (anthropic-messages, etc).
 * - If the base URL is custom (proxy/gateway), create a standalone "nakama"
 *   provider with the OpenAI Chat Completions API ("openai-completions"),
 *   which is the most universally supported format across proxies/gateways.
 *   Using the built-in "anthropic" or "openai" provider with a custom base URL
 *   would keep the Anthropic Messages / OpenAI Responses API format, which most
 *   proxies don't support.
 */
export async function writePiModelsJson(
  configDir: string,
  routing: CodingAgentProviderRouting,
  providerType: ProviderName
): Promise<string> {
  const configPath = path.join(configDir, "models.json");
  const baseUrl = routing.baseUrl ?? "";
  const apiKey = routing.apiKey ?? "";

  const providers: Record<string, Record<string, unknown>> = {};

  if (isDefaultBaseUrl(providerType, routing.baseUrl)) {
    // Override the built-in provider's baseUrl + apiKey.
    // The built-in provider keeps its native API type (anthropic-messages,
    // openai-responses, openai-completions, etc).
    const providerId = resolvePiProviderId(providerType);
    providers[providerId] = {
      apiKey,
      baseUrl,
    };
  } else {
    // Custom base URL (proxy/gateway): create a standalone "nakama" provider
    // with the OpenAI Chat Completions API, which is universally supported.
    const model = formatModelForHarness(
      "pi",
      providerType,
      routing.model ?? "gpt-4o"
    );
    providers["nakama"] = {
      api: "openai-completions",
      apiKey,
      baseUrl,
      models: [
        {
          contextWindow: 128_000,
          id: model,
          input: ["text"],
          maxTokens: 16_384,
          name: model,
          reasoning: false,
        },
      ],
      name: "Nakama",
    };
  }

  const config = { providers };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(configPath, 0o600);
  return configPath;
}
