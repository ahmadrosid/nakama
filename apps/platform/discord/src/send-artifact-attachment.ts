import {
  DISCORD_ARTIFACT_ATTACHMENT_MAX_BYTES,
  formatDiscordAttachmentSizeLimitMessage,
  formatDiscordUnsupportedAttachmentMessage,
  isDiscordAttachableArtifact,
} from "@nakama/core/discord-attachment";
import { AttachmentBuilder, type TextBasedChannel } from "discord.js";

export {
  DISCORD_ARTIFACT_ATTACHMENT_MAX_BYTES,
  isDiscordAttachableArtifact,
} from "@nakama/core/discord-attachment";

export interface SendArtifactAttachmentInput {
  bytes: Uint8Array;
  filename: string;
  mimeType?: string;
}

export interface SendArtifactAttachmentResult {
  error?: string;
  ok: boolean;
}

export async function sendDiscordArtifactAttachment(
  channel: TextBasedChannel,
  input: SendArtifactAttachmentInput
): Promise<SendArtifactAttachmentResult> {
  if (input.bytes.byteLength > DISCORD_ARTIFACT_ATTACHMENT_MAX_BYTES) {
    return {
      error: formatDiscordAttachmentSizeLimitMessage(input.bytes.byteLength),
      ok: false,
    };
  }

  if (!isDiscordAttachableArtifact(input)) {
    return {
      error: formatDiscordUnsupportedAttachmentMessage(input),
      ok: false,
    };
  }

  try {
    const attachment = new AttachmentBuilder(Buffer.from(input.bytes)).setName(
      input.filename
    );
    await channel.send({ files: [attachment] });
    return { ok: true };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Failed to send attachment.",
      ok: false,
    };
  }
}
