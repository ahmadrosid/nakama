import type { NakamaClient } from "@nakama/client";
import type { SendMessageInput } from "@nakama/core/contract";
import type { Context } from "grammy";
import { downloadTelegramFile, OversizedTelegramFileError } from "./attachments";

export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export const OVERSIZED_AUDIO_REPLY = "Audio is too large. Maximum size is 25 MB.";

export function hasTelegramAudio(ctx: Context): boolean {
  return Boolean(ctx.message?.voice || ctx.message?.audio);
}

export async function buildTelegramAudioInput(
  ctx: Context,
  client: NakamaClient,
): Promise<SendMessageInput | null> {
  const voice = ctx.message?.voice;
  const audio = ctx.message?.audio;
  const fileId = voice?.file_id ?? audio?.file_id;

  if (!fileId) {
    return null;
  }

  const downloaded = await downloadTelegramFile(ctx, fileId, MAX_AUDIO_BYTES);
  const filename = inferAudioFilename(downloaded.filePath, Boolean(voice), audio?.file_name);
  const mediaType = inferAudioMediaType(downloaded.filePath, downloaded.contentType, Boolean(voice));

  const { text } = await client.transcribeAudio({
    mediaType,
    data: Buffer.from(downloaded.bytes).toString("base64"),
    filename,
  });

  const caption = ctx.message?.caption?.trim() ?? "";
  const message = caption ? `${text}\n\n${caption}` : text;

  return { message };
}

export function formatTelegramAudioError(error: unknown): string {
  if (error instanceof OversizedTelegramFileError) {
    return OVERSIZED_AUDIO_REPLY;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function inferAudioFilename(
  filePath: string,
  isVoice: boolean,
  originalName?: string,
): string {
  if (originalName?.trim()) {
    return originalName.trim();
  }

  const extension = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();

  if (extension && extension !== filePath) {
    return `audio${extension}`;
  }

  return isVoice ? "voice.ogg" : "audio.m4a";
}

function inferAudioMediaType(
  filePath: string,
  headerType: string | null,
  isVoice: boolean,
): string {
  if (headerType?.startsWith("audio/")) {
    return headerType.split(";")[0]!.trim();
  }

  const extension = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();

  switch (extension) {
    case ".ogg":
      return "audio/ogg";
    case ".mp3":
      return "audio/mpeg";
    case ".m4a":
      return "audio/mp4";
    case ".wav":
      return "audio/wav";
    case ".webm":
      return "audio/webm";
    default:
      return isVoice ? "audio/ogg" : "audio/mpeg";
  }
}
