import {
  createTypingLoop as createSharedTypingLoop,
  type TypingLoop,
} from "@nakama/core/channel-typing-loop";
import type { DiscordMessenger } from "./messenger";

export type { TypingLoop };

export function createTypingLoop(messenger: DiscordMessenger): TypingLoop {
  return createSharedTypingLoop(() => messenger.sendTyping(), {
    refreshMs: 8000,
  });
}
