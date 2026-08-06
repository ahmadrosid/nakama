import { AttachmentBuilder, type TextBasedChannel } from "discord.js";

export const DISCORD_ARTIFACT_ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;

export interface SendArtifactAttachmentInput {
  filename: string;
  bytes: Uint8Array;
}

export interface SendArtifactAttachmentResult {
  ok: boolean;
  error?: string;
}

export async function sendDiscordArtifactAttachment(
  channel: TextBasedChannel,
  input: SendArtifactAttachmentInput,
): Promise<SendArtifactAttachmentResult> {
  if (input.bytes.byteLength > DISCORD_ARTIFACT_ATTACHMENT_MAX_BYTES) {
    return {
      ok: false,
      error: `File is too large for Discord (${formatMegabytes(input.bytes.byteLength)}; max ${formatMegabytes(DISCORD_ARTIFACT_ATTACHMENT_MAX_BYTES)}). Use the share link instead.`,
    };
  }

  try {
    const attachment = new AttachmentBuilder(Buffer.from(input.bytes)).setName(input.filename);
    await channel.send({ files: [attachment] });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to send attachment.",
    };
  }
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
