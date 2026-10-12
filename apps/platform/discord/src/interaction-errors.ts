import { MessageFlags } from "discord.js";
import { z } from "zod";

export const discordErrorSchema = z.object({ code: z.number() }).passthrough();

export type DiscordErrorInput =
  | Error
  | z.infer<typeof discordErrorSchema>
  | { code: string }
  | null;

/** Discord: Unknown interaction (expired or already handled). */
const UNKNOWN_INTERACTION = 10_062;

/** Discord: Interaction has already been acknowledged. */
const ALREADY_ACKNOWLEDGED = 40_060;

export function getDiscordErrorCode(error: DiscordErrorInput): number | null {
  const parsed = discordErrorSchema.safeParse(error);

  return parsed.success ? parsed.data.code : null;
}

export function isIgnorableInteractionError(error: DiscordErrorInput): boolean {
  const code = getDiscordErrorCode(error);

  return code === UNKNOWN_INTERACTION || code === ALREADY_ACKNOWLEDGED;
}

type SlashDeferInteraction = {
  commandName: string;
  deferReply: (options?: {
    flags: typeof MessageFlags.Ephemeral;
  }) => Promise<void>;
  reply: (options: { content: string }) => Promise<void>;
  editReply: (options: { content: string }) => Promise<void>;
};

/**
 * Acknowledge a slash command immediately. Returns whether the handler should
 * continue into command work.
 */
export async function deferSlashInteraction(
  interaction: SlashDeferInteraction
): Promise<boolean> {
  try {
    await interaction.deferReply(
      ["org", "profile", "sessions"].includes(interaction.commandName)
        ? { flags: MessageFlags.Ephemeral }
        : undefined
    );

    return true;
  } catch (error) {
    const discordError =
      error instanceof Error
        ? error
        : (discordErrorSchema.safeParse(error).data ?? null);

    if (isIgnorableInteractionError(discordError)) {
      console.warn(
        `Skipped stale /${interaction.commandName} interaction (${getDiscordErrorCode(discordError)}).`
      );

      return false;
    }

    console.error("Failed to acknowledge slash command:", error);

    // Prefer reply when defer never landed; fall back to editReply if Discord
    // already acknowledged through another path.
    try {
      await interaction.reply({ content: "Something went wrong." });
    } catch {
      try {
        await interaction.editReply({ content: "Something went wrong." });
      } catch {
        // Interaction is unusable — user already sees Discord's failure state.
      }
    }

    return false;
  }
}
