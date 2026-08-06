import * as readline from "node:readline/promises";
import type { NakamaClient } from "@nakama/client";
import {
  getUserConfigPath,
  promptForProviderConfig,
  type ProviderModelOption,
  type UserProviderName,
} from "@nakama/core";

function readPassword(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;

    if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
      reject(new Error("Terminal does not support raw mode"));
      return;
    }

    stdout.write(prompt);

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    let password = "";

    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\n" || char === "\r" || char === "\u0004") {
          // Enter or EOF
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener("data", onData);
          stdout.write("\n");
          resolve(password);
          return;
        }

        if (char === "\u0003") {
          // Ctrl+C
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener("data", onData);
          stdout.write("\n");
          process.exit(130);
        }

        if (char === "\u007f" || char === "\b") {
          // Backspace
          if (password.length > 0) {
            password = password.slice(0, -1);
            stdout.write("\b \b");
          }
        } else if (char >= " " && char <= "~") {
          // Printable ASCII
          password += char;
          stdout.write("*");
        }
      }
    };

    stdin.on("data", onData);
  });
}

export async function ensureUserConfiguredViaCli(
  client: NakamaClient,
): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return false;
  }

  console.log("Nakama admin setup\n");
  console.log("No admin user found. Let's create one.\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let email: string;
  try {
    email = await rl.question("Email: ");
  } finally {
    rl.close();
  }

  const password = await readPassword("Password: ");
  const confirmPassword = await readPassword("Confirm password: ");

  if (password !== confirmPassword) {
    console.log("Passwords do not match.");
    return false;
  }

  if (password.length < 8) {
    console.log("Password must be at least 8 characters.");
    return false;
  }

  try {
    const result = await client.setupUser(email, password);
    client.setAuthToken(result.token);
    console.log("Admin user created successfully.");
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`Failed to create admin user: ${message}`);
    return false;
  }
}

export async function ensureProviderConfiguredViaCli(
  client: NakamaClient,
): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return false;
  }

  const catalog = await client.getModels();
  const modelHelpers = createModelHelpers(catalog.models);

  console.log("Nakama setup\n");
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

    const instance = config.providers[0]!;
    const model =
      instance.customModels?.find((entry) => entry.default)?.id ??
      instance.customModels?.[0]?.id ??
      modelHelpers.getDefaultModel(instance.type);

    const result = await client.configureProvider({
      apiKey: instance.apiKey,
      model,
      provider: instance.type,
      displayName: instance.type === "openai_compatible" ? instance.label : undefined,
      baseUrl: instance.baseUrl,
      hostMode: instance.hostMode,
      customModels: instance.customModels,
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
