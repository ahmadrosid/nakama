import type { Message, TextBasedChannel } from "discord.js";
import { splitDiscordMessage } from "./format";

export interface DiscordMessenger {
  edit(messageId: string, text: string): Promise<void>;
  send(text: string): Promise<{ id: string } | null>;
  sendTyping(): Promise<void>;
}

export function createDiscordMessenger(
  channel: TextBasedChannel
): DiscordMessenger {
  return {
    async edit(messageId: string, text: string) {
      const message = await channel.messages.fetch(messageId);
      await message.edit(text.slice(0, 2000));
    },
    async send(text: string) {
      const chunks = splitDiscordMessage(text);
      let last: { id: string } | null = null;

      for (const chunk of chunks) {
        const message = await channel.send(chunk);
        last = { id: message.id };
      }

      return last;
    },
    async sendTyping() {
      if ("sendTyping" in channel) {
        await channel.sendTyping();
      }
    },
  };
}

export function createInteractionMessenger(
  followUp: (content: string) => Promise<void>,
  editReply: (content: string) => Promise<void>
): DiscordMessenger {
  let answered = false;

  return {
    async edit(_messageId: string, text: string) {
      await editReply(text.slice(0, 2000));
    },
    async send(text: string) {
      const chunks = splitDiscordMessage(text);

      for (const chunk of chunks) {
        if (!answered) {
          await editReply(chunk);
          answered = true;
          continue;
        }

        await followUp(chunk);
      }

      return { id: "interaction" };
    },
    async sendTyping() {},
  };
}

export function getMessageChannel(message: Message): TextBasedChannel {
  if (!message.channel.isTextBased()) {
    throw new Error("Unsupported channel type");
  }

  return message.channel;
}
