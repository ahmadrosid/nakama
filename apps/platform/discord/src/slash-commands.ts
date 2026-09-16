import {
  type Client,
  InteractionContextType,
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
  "allow",
  "org",
  "profile",
  "sessions",
  "resume",
] as const;

export function buildSlashCommands(): SlashCommandBuilder[] {
  const descriptions: Record<(typeof COMMAND_NAMES)[number], string> = {
    allow: "Add a Discord user to the bot allowed list",
    clear: "Clear chat history",
    close: "Close this bot conversation thread",
    compact: "Compact conversation history",
    help: "Show available commands",
    new: "Start a new conversation",
    org: "Choose an organization",
    profile: "Choose a bot profile",
    resume: "Resume an earlier conversation by ID",
    sessions: "Pick an earlier conversation to resume",
    start: "Welcome and pairing help",
    status: "Show server and model status",
    stop: "Stop the current agent reply",
  };

  return COMMAND_NAMES.map((name) => {
    const builder = new SlashCommandBuilder()
      .setName(name)
      .setDescription(descriptions[name])
      .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM);

    if (name === "resume") {
      builder.addStringOption((option) =>
        option
          .setName("session")
          .setDescription("Session ID from /sessions (the short form works)")
          .setRequired(true)
      );
    }

    if (name === "allow") {
      builder.addUserOption((option) =>
        option
          .setName("user")
          .setDescription("Discord user to allow")
          .setRequired(true)
      );
    }

    return builder;
  });
}

export async function registerSlashCommands(
  client: Client<true>
): Promise<void> {
  const body = buildSlashCommands().map((command) => command.toJSON());
  await client.application.commands.set(body);
  console.log(`Registered ${body.length} Discord slash commands.`);
}
