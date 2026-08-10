import type {
  ModelsResponse,
  ProfileSummary,
  ProviderModelOption,
} from "@nakama/core";

export function parseModelCommandArg(raw: string): {
  providerId: string | null;
  modelId: string;
} {
  const trimmed = raw.trim();
  const separator = trimmed.indexOf("::");

  if (separator > 0) {
    return {
      modelId: trimmed.slice(separator + 2),
      providerId: trimmed.slice(0, separator),
    };
  }

  return { modelId: trimmed, providerId: null };
}

export function resolveModelSwitchTarget(
  cached: ModelsResponse,
  rawArg: string
): { providerId: string; modelId: string } | "unknown" | "ambiguous" {
  const { providerId: explicitProviderId, modelId } =
    parseModelCommandArg(rawArg);

  if (!modelId) {
    return "unknown";
  }

  if (explicitProviderId) {
    const match = cached.models.find(
      (model) =>
        model.id === modelId &&
        (model.providerId ?? model.provider) === explicitProviderId
    );

    if (match?.providerId) {
      return { modelId, providerId: match.providerId };
    }

    if (
      cached.providers.some((provider) => provider.id === explicitProviderId)
    ) {
      return { modelId, providerId: explicitProviderId };
    }

    return "unknown";
  }

  const matches = cached.models.filter((model) => model.id === modelId);

  if (matches.length === 1 && matches[0]!.providerId) {
    return { modelId, providerId: matches[0]!.providerId };
  }

  if (matches.length > 1) {
    const onCurrent = matches.find(
      (model) => model.providerId === cached.currentProviderId
    );

    if (onCurrent?.providerId) {
      return { modelId, providerId: onCurrent.providerId };
    }

    return "ambiguous";
  }

  if (cached.currentProviderId) {
    return { modelId, providerId: cached.currentProviderId };
  }

  return "unknown";
}

export function effectiveModelState(
  profile: ProfileSummary,
  models: ModelsResponse | null
): { modelId: string | null; providerId: string | null } {
  if (!profile.model?.trim()) {
    return { modelId: null, providerId: models?.currentProviderId ?? null };
  }

  const { providerId, modelId } = parseModelCommandArg(profile.model);

  if (!modelId) {
    return { modelId: null, providerId: models?.currentProviderId ?? null };
  }

  if (providerId) {
    return { modelId, providerId };
  }

  const match = models?.models.find((model) => model.id === modelId);

  return {
    modelId,
    providerId: match?.providerId ?? models?.currentProviderId ?? null,
  };
}

export function isActiveModelOption(
  model: ProviderModelOption,
  active: { modelId: string | null; providerId: string | null }
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
  description: string;
  name: string;
}

export interface PromptSuggestion {
  description: string;
  insertValue: string;
  label: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { description: "show commands", name: "/help" },
  { description: "attach image from clipboard", name: "/paste" },
  { description: "clear history", name: "/clear" },
  { description: "compact conversation history", name: "/compact" },
  { description: "show server and model status", name: "/status" },
  { description: "draft an automation", name: "/create" },
  { description: "show or initialize profile soul files", name: "/soul" },
  { description: "show or initialize USER.md", name: "/user" },
  { description: "choose a model", name: "/models" },
  { description: "show or switch model", name: "/model" },
  { description: "show or change extended thinking", name: "/thinking" },
  { description: "toggle layout debug overlay", name: "/debug" },
  { description: "show or switch bot profile", name: "/profile" },
  { description: "quit", name: "/exit" },
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
  currentModel?: string | null;
  currentProfileId?: string | null;
  currentProviderId?: string | null;
  input: string;
  models?: ProviderModelOption[];
  profiles?: ProfileSummary[];
}

export function resolveSuggestions(
  options: ResolveSuggestionsOptions
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
          description: `${profile.name}${markers ? ` (${markers})` : ""}`,
          insertValue: `/profile ${profile.id}`,
          label: profile.id,
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
          description: `${model.name} [${model.providerLabel ?? model.provider}]${markers ? ` (${markers})` : ""}`,
          insertValue: `/model ${formatModelCommandArg(model)}`,
          label: model.id,
        };
      });
  }

  const soulMatch = input.match(/^\/soul(?:\s+(.*))?$/);

  if (soulMatch) {
    const query = (soulMatch[1] ?? "").trim().toLowerCase();
    const subcommands = [
      {
        description: "scaffold soul templates for current profile",
        name: "init",
      },
    ];

    return subcommands
      .filter((command) => !query || command.name.startsWith(query))
      .map((command) => ({
        description: command.description,
        insertValue: `/soul ${command.name}`,
        label: command.name,
      }));
  }

  const userMatch = input.match(/^\/user(?:\s+(.*))?$/);

  if (userMatch) {
    const query = (userMatch[1] ?? "").trim().toLowerCase();
    const subcommands = [
      { description: "scaffold USER.md template", name: "init" },
    ];

    return subcommands
      .filter((command) => !query || command.name.startsWith(query))
      .map((command) => ({
        description: command.description,
        insertValue: `/user ${command.name}`,
        label: command.name,
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
    description: command.description,
    insertValue: COMMANDS_WITH_ARGS.has(command.name)
      ? `${command.name} `
      : command.name,
    label: command.name,
  }));
}

export function formatSlashCommands(): string {
  return SLASH_COMMANDS.map(
    (command) => `${command.name.padEnd(16)} ${command.description}`
  ).join("\n");
}
