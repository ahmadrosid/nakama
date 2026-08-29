import type { ChatInputCommandInteraction } from "discord.js";
import {
  getDiscordErrorCode,
  isIgnorableInteractionError,
} from "./interaction-errors";

const DEFER_FAILURE_REPLY = "Something went wrong.";

/**
 * Acknowledge a slash command immediately. Returns whether the handler should
 * continue into command work.
 */
export async function deferSlashInteraction(
  interaction: Pick<
    ChatInputCommandInteraction,
    "deferReply" | "editReply" | "reply" | "commandName"
  >
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
      await interaction.reply({ content: DEFER_FAILURE_REPLY });
    } catch {
      try {
        await interaction.editReply({ content: DEFER_FAILURE_REPLY });
      } catch {
        // Interaction is unusable — user already sees Discord's failure state.
      }
    }
    return false;
  }
}
