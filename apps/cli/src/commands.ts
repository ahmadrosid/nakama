import type { ProviderModelOption } from "@tinyclaw/core";

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
  { name: "/clear", description: "clear history" },
  { name: "/create", description: "draft an automation" },
  { name: "/soul", description: "show or initialize agent identity" },
  { name: "/models", description: "list available models" },
  { name: "/model", description: "show or switch model" },
  { name: "/exit", description: "quit" },
];

const COMMANDS_WITH_ARGS = new Set(["/model", "/create", "/soul"]);

export interface ResolveSuggestionsOptions {
  input: string;
  models?: ProviderModelOption[];
  currentModel?: string | null;
}

export function resolveSuggestions(
  options: ResolveSuggestionsOptions,
): PromptSuggestion[] {
  const { input, models = [], currentModel = null } = options;

  if (!input.startsWith("/")) {
    return [];
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
        const markers = [
          model.id === currentModel ? "current" : null,
          model.default ? "default" : null,
        ]
          .filter(Boolean)
          .join(", ");

        return {
          label: model.id,
          description: `${model.name} [${model.provider}]${markers ? ` (${markers})` : ""}`,
          insertValue: `/model ${model.id}`,
        };
      });
  }

  const soulMatch = input.match(/^\/soul(?:\s+(.*))?$/);

  if (soulMatch) {
    const query = (soulMatch[1] ?? "").trim().toLowerCase();
    const subcommands = [{ name: "init", description: "scaffold soul templates" }];

    return subcommands
      .filter((command) => !query || command.name.startsWith(query))
      .map((command) => ({
        label: command.name,
        description: command.description,
        insertValue: `/soul ${command.name}`,
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
