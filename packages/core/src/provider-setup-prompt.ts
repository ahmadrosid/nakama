import {
  isValidBaseUrl,
  normalizeBaseUrl,
  validateCustomModels,
  validateDisplayName,
} from "./compatible-provider-config";
import type { ProviderModelOption } from "./contract";
import {
  defaultOllamaBaseUrl,
  defaultOllamaLabel,
  ollamaRequiresApiKey,
  type OllamaHostMode,
} from "./ollama-provider-config";
import {
  createProviderInstanceId,
  defaultProviderLabel,
  type ProviderInstance,
  type UserConfig,
  type UserProviderName,
} from "./user-config";

export interface ProviderSetupPromptOptions {
  question: (prompt: string) => Promise<string>;
  writeLine: (line: string) => void;
  getModelsForProvider: (provider: UserProviderName) => ProviderModelOption[];
  getDefaultModel: (provider: UserProviderName) => string;
  getModelById: (modelId: string) => ProviderModelOption | undefined;
}

const PROVIDER_CHOICES: Array<{ id: UserProviderName; label: string }> = [
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "gemini", label: "Gemini" },
  { id: "deepseek", label: "DeepSeek" },
  { id: "cerebras", label: "Cerebras" },
  { id: "fireworks", label: "Fireworks" },
  { id: "ollama", label: "Ollama" },
  { id: "opencode_go", label: "OpenCode Go" },
  { id: "openai_compatible", label: "Custom (OpenAI-compatible)" },
];

export async function promptForProviderConfig(
  options: ProviderSetupPromptOptions,
): Promise<UserConfig> {
  const { question, writeLine, getModelsForProvider, getDefaultModel, getModelById } =
    options;

  while (true) {
    writeLine("\nChoose a provider:");
    for (const [index, choice] of PROVIDER_CHOICES.entries()) {
      writeLine(`  ${index + 1}) ${choice.label}`);
    }

    const providerInput = (await question("\nProvider: ")).trim();
    const provider = resolveProviderChoice(providerInput);

    if (!provider) {
      writeLine("Enter a provider number or name.\n");
      continue;
    }

    if (provider === "openai_compatible") {
      const instance = await promptForCompatibleProviderInstance(question, writeLine);
      return buildUserConfigFromInstance(instance);
    }

    if (provider === "ollama") {
      const instance = await promptForOllamaProviderInstance(question, writeLine);
      return buildUserConfigFromInstance(instance);
    }

    const apiKey = (await question("API key: ")).trim();

    if (!apiKey) {
      writeLine("API key is required.\n");
      continue;
    }

    const models = getModelsForProvider(provider);
    writeLine(`\nSelected provider: ${provider}`);
    writeLine("\nAvailable models:");

    for (const [index, model] of models.entries()) {
      const suffix = model.default ? " (default)" : "";
      writeLine(`  ${index + 1}) ${model.name}${suffix}`);
    }

    const modelInput = (await question("\nModel (optional): ")).trim();
    const selectedModel = resolveModelChoice(modelInput, provider, {
      getDefaultModel,
      getModelById,
      getModelsForProvider,
    });

    const catalogModel = getModelById(selectedModel);
    const customModels =
      (provider === "fireworks" || provider === "cerebras") && catalogModel
        ? [
            {
              id: selectedModel,
              default: true,
              ...(catalogModel.supportsThinking !== undefined
                ? { supportsThinking: catalogModel.supportsThinking }
                : {}),
              ...(catalogModel.supportsVision !== undefined
                ? { supportsVision: catalogModel.supportsVision }
                : {}),
              ...(catalogModel.inputPerMillionUsd !== undefined
                ? { inputPerMillionUsd: catalogModel.inputPerMillionUsd }
                : {}),
              ...(catalogModel.outputPerMillionUsd !== undefined
                ? { outputPerMillionUsd: catalogModel.outputPerMillionUsd }
                : {}),
            },
          ]
        : undefined;

    const instance: ProviderInstance = {
      id: createProviderInstanceId(),
      type: getModelById(selectedModel)?.provider ?? provider,
      label: defaultProviderLabel(provider, []),
      apiKey,
      createdAt: new Date().toISOString(),
      ...(customModels ? { customModels } : {}),
    };

    return buildUserConfigFromInstance(instance);
  }
}

function buildUserConfigFromInstance(instance: ProviderInstance): UserConfig {
  return {
    defaultProviderId: instance.id,
    providers: [instance],
  };
}

function resolveProviderChoice(input: string): UserProviderName | null {
  const normalized = input.trim().toLowerCase();

  if (
    normalized === "openai" ||
    normalized === "anthropic" ||
    normalized === "openrouter" ||
    normalized === "gemini" ||
    normalized === "deepseek" ||
    normalized === "cerebras" ||
    normalized === "fireworks" ||
    normalized === "ollama" ||
    normalized === "openai_compatible" ||
    normalized === "opencode_go"
  ) {
    return normalized;
  }

  const numeric = Number(input);

  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= PROVIDER_CHOICES.length) {
    return PROVIDER_CHOICES[numeric - 1]!.id;
  }

  return null;
}

function resolveModelChoice(
  input: string,
  provider: UserProviderName,
  options: Pick<
    ProviderSetupPromptOptions,
    "getDefaultModel" | "getModelById" | "getModelsForProvider"
  >,
): string {
  if (!input) {
    return options.getDefaultModel(provider);
  }

  const match = options.getModelById(input);

  if (match && match.provider === provider) {
    return match.id;
  }

  if (provider === "openrouter" && /^[\w.-]+\/[\w.:-]+$/.test(input)) {
    return input;
  }

  const numeric = Number(input);
  const models = options.getModelsForProvider(provider);

  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= models.length) {
    return models[numeric - 1]!.id;
  }

  return options.getDefaultModel(provider);
}

async function promptForOllamaProviderInstance(
  question: (prompt: string) => Promise<string>,
  writeLine: (line: string) => void,
): Promise<ProviderInstance> {
  while (true) {
    writeLine("\nOllama host: 1) Local  2) Cloud");
    const hostInput = (await question("Host [1]: ")).trim().toLowerCase();
    const hostMode: OllamaHostMode =
      hostInput === "2" || hostInput === "cloud" ? "cloud" : "local";
    const defaultBaseUrl = defaultOllamaBaseUrl(hostMode);
    const baseUrl = normalizeBaseUrl(
      (await question(`Base URL (${defaultBaseUrl}): `)).trim() || defaultBaseUrl,
    );

    if (!isValidBaseUrl(baseUrl)) {
      writeLine("Enter a valid http(s) base URL.\n");
      continue;
    }

    const apiKey = (
      await question(ollamaRequiresApiKey(hostMode) ? "API key: " : "API key (optional): ")
    ).trim();

    if (ollamaRequiresApiKey(hostMode) && !apiKey) {
      writeLine("API key is required for Ollama Cloud.\n");
      continue;
    }

    const modelIds = (await question("Model IDs (comma-separated): "))
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    if (modelIds.length === 0) {
      writeLine("Enter at least one model id.\n");
      continue;
    }

    return {
      id: createProviderInstanceId(),
      type: "ollama",
      label: defaultOllamaLabel(hostMode),
      apiKey,
      baseUrl,
      hostMode,
      customModels: validateCustomModels(
        modelIds.map((id, index) => ({
          id,
          ...(index === 0 ? { default: true } : {}),
        })),
      ),
      createdAt: new Date().toISOString(),
    };
  }
}

async function promptForCompatibleProviderInstance(
  question: (prompt: string) => Promise<string>,
  writeLine: (line: string) => void,
): Promise<ProviderInstance> {
  while (true) {
    const displayName = validateDisplayName(await question("Provider name: "));
    const baseUrlInput = (await question("Base URL: ")).trim();

    if (!isValidBaseUrl(baseUrlInput)) {
      writeLine("Enter a valid http(s) base URL.\n");
      continue;
    }

    const baseUrl = normalizeBaseUrl(baseUrlInput);
    const apiKey = (await question("API key (optional): ")).trim();
    const modelIds = (await question("Model IDs (comma-separated): "))
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    if (modelIds.length === 0) {
      writeLine("Enter at least one model id.\n");
      continue;
    }

    const customModels = validateCustomModels(
      modelIds.map((id, index) => ({
        id,
        ...(index === 0 ? { default: true } : {}),
      })),
    );

    return {
      id: createProviderInstanceId(),
      type: "openai_compatible",
      label: displayName,
      apiKey,
      baseUrl,
      customModels,
      createdAt: new Date().toISOString(),
    };
  }
}
