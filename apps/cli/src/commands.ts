import type { ModelsResponse, ProfileSummary, ProviderModelOption } from "@tinyclaw/core";

export function parseModelCommandArg(raw: string): {
  providerId: string | null;
  modelId: string;
} {
  const trimmed = raw.trim();
  const separator = trimmed.indexOf("::");

  if (separator > 0) {
    return {
      providerId: trimmed.slice(0, separator),
      modelId: trimmed.slice(separator + 2),
    };
  }

  return { providerId: null, modelId: trimmed };
}

export function resolveModelSwitchTarget(
  cached: ModelsResponse,
  rawArg: string,
): { providerId: string; modelId: string } | "unknown" | "ambiguous" {
  const { providerId: explicitProviderId, modelId } = parseModelCommandArg(rawArg);

  if (!modelId) {
    return "unknown";
  }

  if (explicitProviderId) {
    const match = cached.models.find(
      (model) =>
        model.id === modelId &&
        (model.providerId ?? model.provider) === explicitProviderId,
    );

    if (match?.providerId) {
      return { providerId: match.providerId, modelId };
    }

    if (cached.providers.some((provider) => provider.id === explicitProviderId)) {
      return { providerId: explicitProviderId, modelId };
    }

    return "unknown";
  }

  const matches = cached.models.filter((model) => model.id === modelId);

  if (matches.length === 1 && matches[0]!.providerId) {
    return { providerId: matches[0]!.providerId, modelId };
  }

  if (matches.length > 1) {
    const onCurrent = matches.find((model) => model.providerId === cached.currentProviderId);

    if (onCurrent?.providerId) {
      return { providerId: onCurrent.providerId, modelId };
    }

    return "ambiguous";
  }

  if (cached.currentProviderId) {
    return { providerId: cached.currentProviderId, modelId };
  }

  return "unknown";
}

export function effectiveModelState(
  profile: ProfileSummary,
  models: ModelsResponse | null,
): { modelId: string | null; providerId: string | null } {
  if (!profile.model?.trim()) {
    return { modelId: null, providerId: models?.currentProviderId ?? null };
  }

  const { providerId, modelId } = parseModelCommandArg(profile.model);

  if (!modelId) {
    return { modelId: null, providerId: models?.currentProviderId ?? null };
  }

  if (providerId) {
    return { providerId, modelId };
  }

  const match = models?.models.find((model) => model.id === modelId);

  return {
    modelId,
    providerId: match?.providerId ?? models?.currentProviderId ?? null,
  };
}

export function isActiveModelOption(
  model: ProviderModelOption,
  active: { modelId: string | null; providerId: string | null },
): boolean {
  if (!active.modelId || model.id !== active.modelId) {
    return false;
  }

  if (!active.providerId) {
    return true;
  }

  return (model.providerId ?? model.provider) === active.providerId;
}

export function formatModelCommandArg(model: ProviderModelOption): string {
  return model.providerId ? `${model.providerId}::${model.id}` : model.id;
}

export interface SlashCommand {
  name: string;
  description: string;
}

export interface PromptSuggestion {
  label: string;
  description: string;
  insertValue: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "/help", description: "show commands" },
  { name: "/paste", description: "attach image from clipboard" },
  { name: "/clear", description: "clear history" },
  { name: "/compact", description: "compact conversation history" },
  { name: "/create", description: "draft an automation" },
  { name: "/soul", description: "show or initialize profile soul files" },
  { name: "/user", description: "show or initialize USER.md" },
  { name: "/models", description: "list available models" },
  { name: "/model", description: "show or switch model" },
  { name: "/thinking", description: "show or change extended thinking" },
  { name: "/debug", description: "toggle layout debug overlay" },
  { name: "/profile", description: "show or switch bot profile" },
  { name: "/exit", description: "quit" },
];

const COMMANDS_WITH_ARGS = new Set([
  "/model",
  "/thinking",
  "/profile",
  "/create",
  "/soul",
  "/user",
]);

export interface ResolveSuggestionsOptions {
  input: string;
  models?: ProviderModelOption[];
  currentModel?: string | null;
  currentProviderId?: string | null;
  profiles?: ProfileSummary[];
  currentProfileId?: string | null;
}

export function resolveSuggestions(
  options: ResolveSuggestionsOptions,
): PromptSuggestion[] {
  const {
    input,
    models = [],
    currentModel = null,
    currentProviderId = null,
    profiles = [],
    currentProfileId = null,
  } = options;

  if (!input.startsWith("/")) {
    return [];
  }

  const profileMatch = input.match(/^\/profile(?:\s+(.*))?$/);

  if (profileMatch) {
    const query = (profileMatch[1] ?? "").trim().toLowerCase();

    return profiles
      .filter((profile) => {
        if (!query) {
          return true;
        }

        return (
          profile.id.toLowerCase().includes(query) ||
          profile.name.toLowerCase().includes(query)
        );
      })
      .map((profile) => {
        const markers = [
          profile.id === currentProfileId ? "current" : null,
          profile.isSuper ? "orchestrator" : null,
        ]
          .filter(Boolean)
          .join(", ");

        return {
          label: profile.id,
          description: `${profile.name}${markers ? ` (${markers})` : ""}`,
          insertValue: `/profile ${profile.id}`,
        };
      });
  }

  const modelMatch = input.match(/^\/model(?:\s+(.*))?$/);

  if (modelMatch) {
    const query = (modelMatch[1] ?? "").trim().toLowerCase();

    return models
      .filter((model) => {
        if (!query) {
          return true;
        }

        return (
          model.id.toLowerCase().includes(query) ||
          model.name.toLowerCase().includes(query) ||
          model.provider.toLowerCase().includes(query)
        );
      })
      .map((model) => {
        const active = { modelId: currentModel, providerId: currentProviderId };
        const markers = [
          isActiveModelOption(model, active) ? "current" : null,
          model.default ? "default" : null,
        ]
          .filter(Boolean)
          .join(", ");

        return {
          label: model.id,
          description: `${model.name} [${model.providerLabel ?? model.provider}]${markers ? ` (${markers})` : ""}`,
          insertValue: `/model ${formatModelCommandArg(model)}`,
        };
      });
  }

  const soulMatch = input.match(/^\/soul(?:\s+(.*))?$/);

  if (soulMatch) {
    const query = (soulMatch[1] ?? "").trim().toLowerCase();
    const subcommands = [{ name: "init", description: "scaffold soul templates for current profile" }];

    return subcommands
      .filter((command) => !query || command.name.startsWith(query))
      .map((command) => ({
        label: command.name,
        description: command.description,
        insertValue: `/soul ${command.name}`,
      }));
  }

  const userMatch = input.match(/^\/user(?:\s+(.*))?$/);

  if (userMatch) {
    const query = (userMatch[1] ?? "").trim().toLowerCase();
    const subcommands = [{ name: "init", description: "scaffold USER.md template" }];

    return subcommands
      .filter((command) => !query || command.name.startsWith(query))
      .map((command) => ({
        label: command.name,
        description: command.description,
        insertValue: `/user ${command.name}`,
      }));
  }

  if (input.includes(" ")) {
    return [];
  }

  const query = input.toLowerCase();

  return SLASH_COMMANDS.filter((command) => {
    if (query === "/") {
      return true;
    }

    return (
      command.name.toLowerCase().startsWith(query) ||
      command.description.toLowerCase().includes(query.slice(1))
    );
  }).map((command) => ({
    label: command.name,
    description: command.description,
    insertValue: COMMANDS_WITH_ARGS.has(command.name)
      ? `${command.name} `
      : command.name,
  }));
}

export function formatSlashCommands(): string {
  return SLASH_COMMANDS.map(
    (command) => `${command.name.padEnd(16)} ${command.description}`,
  ).join("\n");
}
