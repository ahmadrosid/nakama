import { prepareTelegramReply, splitIntoChatBubbles } from "./format";
import type { TelegramRichMessenger } from "./rich-message";

const DEFAULT_BUBBLE_DELAY_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function replyAsChat(
  messenger: TelegramRichMessenger,
  text: string,
  options: { delayMs?: number } = {},
): Promise<void> {
  const prepared = prepareTelegramReply(text);

  if (!prepared) {
    return;
  }

  const bubbles = splitIntoChatBubbles(prepared);
  const delayMs = options.delayMs ?? DEFAULT_BUBBLE_DELAY_MS;

  for (let index = 0; index < bubbles.length; index++) {
    await messenger.send(bubbles[index]!);

    if (index < bubbles.length - 1 && delayMs > 0) {
      await sleep(delayMs);
    }
  }
}
