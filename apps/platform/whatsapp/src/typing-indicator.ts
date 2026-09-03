import {
  createTypingLoop as createSharedTypingLoop,
  type TypingLoop,
} from "@nakama/core/channel-typing-loop";
import type { WASocket } from "@whiskeysockets/baileys";

export type { TypingLoop };

export function createTypingLoop(
  socket: WASocket | null,
  jid: string
): TypingLoop {
  return createSharedTypingLoop(async () => {
    if (!socket) {
      return;
    }
    await socket.sendPresenceUpdate("composing", jid);
  });
}
