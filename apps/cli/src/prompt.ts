import * as readline from "node:readline/promises";
import type { ImageAttachment } from "@nakama/core";

export class PromptCancelledError extends Error {
  constructor() {
    super("Prompt cancelled");
    this.name = "PromptCancelledError";
  }
}

export interface PromptLineResult {
  images?: ImageAttachment[];
  text: string;
}

/**
 * Non-TTY / pipe fallback. Sticky TTY input is PersistentPrompt.
 * TerminalLayout.apply() only fails when stdin/stdout are not TTY, so the old
 * raw-mode promptLine path was unreachable in production.
 */
export async function promptLine(
  prefix = "> ",
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout
): Promise<PromptLineResult> {
  const rl = readline.createInterface({ input, output });
  const closed = new Promise<never>((_, reject) => {
    rl.once("close", () => reject(new PromptCancelledError()));
  });

  try {
    const answer = await Promise.race([rl.question(prefix), closed]);
    return { text: answer.trimEnd() };
  } finally {
    rl.close();
  }
}
