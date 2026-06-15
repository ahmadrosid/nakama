import {
  isValidBaseUrl,
  normalizeBaseUrl,
  validateCustomModels,
  validateDisplayName,
} from "./compatible-provider-config";
import type { ProviderModelOption } from "./contract";
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
      return buildUserConfigFromInstance(instance, instance.customModels?.[0]?.id);
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

    const instance: ProviderInstance = {
      id: createProviderInstanceId(),
      type: getModelById(selectedModel)?.provider ?? provider,
      label: defaultProviderLabel(provider, []),
      apiKey,
      createdAt: new Date().toISOString(),
    };

    return buildUserConfigFromInstance(instance, selectedModel);
  }
}

function buildUserConfigFromInstance(
  instance: ProviderInstance,
  model: string | undefined,
): UserConfig {
  return {
    defaultProviderId: instance.id,
    defaultModel: model ?? null,
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
