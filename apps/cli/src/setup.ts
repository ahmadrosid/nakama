import * as readline from "node:readline/promises";
import type { TinyClawClient } from "@tinyclaw/client";
import {
  getUserConfigPath,
  promptForProviderConfig,
  type ProviderModelOption,
  type UserProviderName,
} from "@tinyclaw/core";

export async function ensureProviderConfiguredViaCli(
  client: TinyClawClient,
): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return false;
  }

  const catalog = await client.getModels();
  const modelHelpers = createModelHelpers(catalog.models);

  console.log("TinyClaw setup\n");
  console.log("No API key found. Let's configure one.\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const config = await promptForProviderConfig({
      question: (prompt) => rl.question(prompt),
      writeLine: (line) => console.log(line),
      ...modelHelpers,
    });

    const result = await client.configureProvider({
      apiKey: config.apiKey,
      model: config.model,
      provider: config.provider,
    });

    console.log(
      `\nProvider configured (${result.provider}, ${result.currentModel}).`,
    );
    console.log(`Saved to ${getUserConfigPath()}\n`);

    return true;
  } finally {
    rl.close();
  }
}

function createModelHelpers(models: ProviderModelOption[]) {
  return {
    getModelsForProvider: (provider: UserProviderName) =>
      models.filter((model) => model.provider === provider),
    getDefaultModel: (provider: UserProviderName) => {
      const providerModels = models.filter((model) => model.provider === provider);
      return (
        providerModels.find((model) => model.default)?.id ??
        providerModels[0]?.id ??
        "gpt-5.4"
      );
    },
    getModelById: (modelId: string) => models.find((model) => model.id === modelId),
  };
}
