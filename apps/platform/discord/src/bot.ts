import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type Message,
} from "discord.js";
import type { DiscordBridgeConfig } from "./config";
import { createChatHandler, type ChatHandlerDeps } from "./chat-handler";
import { registerSlashCommands } from "./slash-commands";

export async function createBot(
  config: DiscordBridgeConfig,
  deps: Omit<ChatHandlerDeps, "config" | "getBotInfo">,
): Promise<Client<true>> {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel, Partials.Message],
  }) as Client<true>;

  const handler = createChatHandler({
    ...deps,
    config,
    getBotInfo: () =>
      client.user
        ? { id: client.user.id, username: client.user.username ?? undefined }
        : undefined,
  });

  client.once(Events.ClientReady, async (readyClient) => {
    try {
      await registerSlashCommands(readyClient);
    } catch (error) {
      console.error("Failed to register slash commands:", error);
    }
  });

  client.on(Events.MessageCreate, async (message: Message) => {
    try {
      await handler.handleMessage(message);
    } catch (error) {
      console.error("Message handler error:", error);
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    try {
      await handler.handleSlashCommand(interaction);
    } catch (error) {
      console.error("Slash command error:", error);

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: "Something went wrong." }).catch(() => {});
      } else {
        await interaction
          .reply({ content: "Something went wrong.", ephemeral: true })
          .catch(() => {});
      }
    }
  });

  await client.login(config.botToken);

  if (!client.user) {
    throw new Error("Discord client failed to initialize user.");
  }

  return client;
}
