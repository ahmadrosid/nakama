import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ProviderName } from "@nakama/core";
import type { StoredCodingAgentHarnessKind } from "@nakama/db";
import type { CodingAgentProviderRouting } from "./coding-agent-provider-routing";
import { formatModelForHarness } from "./coding-agent-spawn-env";

export interface HarnessConfigDir {
  dir: string;
  cleanup: () => Promise<void>;
}

export async function createHarnessConfigDir(prefix: string): Promise<HarnessConfigDir> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  await chmod(dir, 0o700);

  return {
    dir,
    cleanup: async () => {
      const { rm } = await import("node:fs/promises");
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export async function writeCodexConfigToml(
  configDir: string,
  routing: CodingAgentProviderRouting,
  harnessKind: StoredCodingAgentHarnessKind,
  providerType: ProviderName,
): Promise<string> {
  const configPath = path.join(configDir, "config.toml");
  const model = formatModelForHarness(
    harnessKind,
    providerType,
    routing.model ?? "gpt-4.1",
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
  providerType: ProviderName,
): Promise<string> {
  const configDir = path.join(configRoot, "opencode");
  await mkdir(configDir, { recursive: true, mode: 0o700 });

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
          baseURL: routing.baseUrl,
          apiKey: routing.apiKey,
        },
        ...(model ? { models: { [model]: { name: model } } } : {}),
      },
    },
    ...(model ? { model: `${providerKey}/${model}` } : {}),
  };

  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
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
