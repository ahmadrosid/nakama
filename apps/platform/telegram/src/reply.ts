import { prepareTelegramReply, splitTelegramMessage } from "./format";
import type { TelegramRichMessenger } from "./rich-message";

const DEFAULT_BUBBLE_DELAY_MS = 400;

export async function replyAsChat(
  messenger: TelegramRichMessenger,
  text: string,
  options: { delayMs?: number } = {}
): Promise<void> {
  const prepared = prepareTelegramReply(text);

  if (!prepared) {
    return;
  }

  const bubbles = splitTelegramMessage(prepared);
  const delayMs = options.delayMs ?? DEFAULT_BUBBLE_DELAY_MS;

  for (let index = 0; index < bubbles.length; index++) {
    await messenger.send(bubbles[index]!);

    if (index < bubbles.length - 1 && delayMs > 0) {
      await Bun.sleep(delayMs);
    }
  }
}
