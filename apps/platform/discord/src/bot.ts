import {
  Client,
  Events,
  GatewayIntentBits,
  type Message,
  Partials,
} from "discord.js";
import { type ChatHandlerDeps, createChatHandler } from "./chat-handler";
import type { DiscordBridgeConfig } from "./config";
import {
  getDiscordErrorCode,
  isIgnorableInteractionError,
} from "./interaction-errors";
import { deferSlashInteraction } from "./slash-ack";
import { registerSlashCommands } from "./slash-commands";

export async function createBot(
  config: DiscordBridgeConfig,
  deps: Omit<ChatHandlerDeps, "config" | "getBotInfo">
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
    console.log(
      [
        "[discord] message",
        `messageId=${message.id}`,
        `authorId=${message.author.id}`,
        `channelId=${message.channelId}`,
        `textBytes=${Buffer.byteLength(message.content ?? "", "utf8")}`,
      ].join(" ")
    );
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

    console.log(
      "[discord] slash",
      interaction.commandName,
      interaction.user.id
    );

    // Acknowledge immediately — Discord expires interactions after ~3s.
    // Any work (locks, API calls) must happen after this.
    if (!(await deferSlashInteraction(interaction))) {
      return;
    }

    try {
      await handler.handleSlashCommand(interaction);
    } catch (error) {
      if (isIgnorableInteractionError(error)) {
        console.warn(
          `Slash command /${interaction.commandName} interaction expired (${getDiscordErrorCode(error)}).`
        );
        return;
      }

      console.error("Slash command error:", error);
      await interaction
        .editReply({ content: "Something went wrong." })
        .catch(() => {});
    }
  });

  await client.login(config.botToken);

  if (!client.user) {
    throw new Error("Discord client failed to initialize user.");
  }

  return client;
}
