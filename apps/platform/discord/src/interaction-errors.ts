/** Discord: Unknown interaction (expired or already handled). */
const UNKNOWN_INTERACTION = 10_062;
/** Discord: Interaction has already been acknowledged. */
const ALREADY_ACKNOWLEDGED = 40_060;

export function getDiscordErrorCode(error: unknown): number | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "number"
  ) {
    return (error as { code: number }).code;
  }

  return null;
}

export function isIgnorableInteractionError(error: unknown): boolean {
  const code = getDiscordErrorCode(error);
  return code === UNKNOWN_INTERACTION || code === ALREADY_ACKNOWLEDGED;
}

type SlashDeferInteraction = {
  commandName: string;
  deferReply: () => Promise<unknown>;
  reply: (options: { content: string }) => Promise<unknown>;
  editReply: (options: { content: string }) => Promise<unknown>;
};

/**
 * Acknowledge a slash command immediately. Returns whether the handler should
 * continue into command work.
 */
export async function deferSlashInteraction(
  interaction: SlashDeferInteraction
): Promise<boolean> {
  try {
    await interaction.deferReply();
    return true;
  } catch (error) {
    if (isIgnorableInteractionError(error)) {
      console.warn(
        `Skipped stale /${interaction.commandName} interaction (${getDiscordErrorCode(error)}).`
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
