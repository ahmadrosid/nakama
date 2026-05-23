import * as readline from "node:readline/promises";
import {
  getUserConfigPath,
  inferProviderFromApiKey,
  loadUserConfig,
  saveUserConfig,
  type UserProviderConfig,
} from "@tinyclaw/core";
import {
  createProviderFromSources,
  getDefaultModel,
  getModelsForProvider,
  getModelById,
} from "./providers";
import type { ProviderClient } from "@tinyclaw/core";

export interface ProviderBootstrap {
  provider: ProviderClient | null;
  userConfig: UserProviderConfig | null;
}

export async function ensureProviderConfigured(): Promise<ProviderBootstrap> {
  let userConfig = await loadUserConfig();
  let provider = createProviderFromSources(process.env, userConfig);

  if (provider) {
    return { provider, userConfig };
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return { provider: null, userConfig: null };
  }

  console.log("TinyClaw server setup\n");
  console.log("No API key found. Let's configure one.\n");

  userConfig = await promptForProviderConfig();
  await saveUserConfig(userConfig);
  console.log(`\nSaved to ${getUserConfigPath()}\n`);

  provider = createProviderFromSources(process.env, userConfig);

  return { provider, userConfig };
}

async function promptForProviderConfig(): Promise<UserProviderConfig> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    while (true) {
      const apiKey = (await rl.question("API key: ")).trim();

      if (!apiKey) {
        console.log("API key is required.\n");
        continue;
      }

      const provider = inferProviderFromApiKey(apiKey);
      const models = getModelsForProvider(provider);
      console.log(`\nDetected provider: ${provider}`);
      console.log("\nAvailable models:");

      for (const [index, model] of models.entries()) {
        const suffix = model.default ? " (default)" : "";
        console.log(`  ${index + 1}) ${model.name}${suffix}`);
      }

      const modelInput = (await rl.question("\nModel (optional): ")).trim();
      const selectedModel = resolveModelChoice(modelInput, provider);

      return {
        provider: getModelById(selectedModel)?.provider ?? provider,
        apiKey,
        model: selectedModel,
      };
    }
  } finally {
    rl.close();
  }
}

function resolveModelChoice(
  input: string,
  provider: UserProviderConfig["provider"],
): string {
  if (!input) {
    return getDefaultModel(provider);
  }

  const match = getModelById(input);

  if (match?.provider === provider) {
    return match.id;
  }

  const numeric = Number(input);
  const models = getModelsForProvider(provider);

  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= models.length) {
    return models[numeric - 1]!.id;
  }

  return getDefaultModel(provider);
}
