import type { ProviderModelOption } from "./contract";
import {
  parseProviderName,
  type UserProviderConfig,
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
];

export async function promptForProviderConfig(
  options: ProviderSetupPromptOptions,
): Promise<UserProviderConfig> {
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

    return {
      provider: getModelById(selectedModel)?.provider ?? provider,
      apiKey,
      model: selectedModel,
    };
  }
}

function resolveProviderChoice(input: string): UserProviderName | null {
  const parsed = parseProviderName(input);

  if (parsed) {
    return parsed;
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
