import {
  InteractionContextType,
  REST,
  Routes,
  SlashCommandBuilder,
  type Client,
} from "discord.js";

const COMMAND_NAMES = ["start", "help", "stop", "clear", "compact", "new", "status"] as const;

export function buildSlashCommands(): SlashCommandBuilder[] {
  const descriptions: Record<(typeof COMMAND_NAMES)[number], string> = {
    start: "Welcome and pairing help",
    help: "Show available commands",
    stop: "Stop the current agent reply",
    clear: "Clear chat history",
    compact: "Compact conversation history",
    new: "Start a new conversation",
    status: "Show server and model status",
  };

  return COMMAND_NAMES.map((name) =>
    new SlashCommandBuilder()
      .setName(name)
      .setDescription(descriptions[name])
      .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM),
  );
}

export async function registerSlashCommands(client: Client<true>): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(client.token);
  const body = buildSlashCommands().map((command) => command.toJSON());

  await rest.put(Routes.applicationCommands(client.user.id), { body });
  console.log(`Registered ${body.length} Discord slash commands.`);
}
