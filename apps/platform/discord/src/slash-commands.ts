import {
  type Client,
  InteractionContextType,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";

const COMMAND_NAMES = [
  "start",
  "help",
  "stop",
  "clear",
  "compact",
  "new",
  "close",
  "status",
] as const;

export function buildSlashCommands(): SlashCommandBuilder[] {
  const descriptions: Record<(typeof COMMAND_NAMES)[number], string> = {
    clear: "Clear chat history",
    close: "Close this bot conversation thread",
    compact: "Compact conversation history",
    help: "Show available commands",
    new: "Start a new conversation",
    start: "Welcome and pairing help",
    status: "Show server and model status",
    stop: "Stop the current agent reply",
  };

  return COMMAND_NAMES.map((name) =>
    new SlashCommandBuilder()
      .setName(name)
      .setDescription(descriptions[name])
      .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM)
  );
}

export async function registerSlashCommands(
  client: Client<true>
): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(client.token);
  const body = buildSlashCommands().map((command) => command.toJSON());

  await rest.put(Routes.applicationCommands(client.user.id), { body });
  console.log(`Registered ${body.length} Discord slash commands.`);
}
