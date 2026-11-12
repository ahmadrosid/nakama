import { z } from "zod";
import { NakamaApiError } from "./api-error";
import { normalizeBaseUrl } from "./compatible-provider-config";
import type { ProviderInstance } from "./user-config";

const TranscriptionResponseSchema = z.object({ text: z.string() });

const ChatTranscriptionResponseSchema = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string().nullish() }) }))
    .min(1),
});

// OpenRouter has no transcriptions endpoint. It takes audio as an
// `input_audio` part of a chat message, named by its file format.
const AUDIO_FORMATS = new Map([
  ["aac", "aac"],
  ["aiff", "aiff"],
  ["flac", "flac"],
  ["m4a", "m4a"],
  ["mp3", "mp3"],
  ["mp4", "m4a"],
  ["mpeg", "mp3"],
  ["mpga", "mp3"],
  ["oga", "ogg"],
  ["ogg", "ogg"],
  ["wav", "wav"],
  ["webm", "webm"],
]);

function audioFormat(audio: { filename: string; mediaType: string }) {
  const extension = audio.filename.split(".").pop()?.toLowerCase() ?? "";
  const subtype = audio.mediaType.split("/")[1]?.split(";")[0]?.toLowerCase();

  return (
    AUDIO_FORMATS.get(extension) ?? (subtype && AUDIO_FORMATS.get(subtype))
  );
}

async function transcribeWithChat(options: {
  apiKey: string;
  audio: { bytes: Uint8Array; filename: string; mediaType: string };
  baseUrl: string;
  model: string;
  signal?: AbortSignal;
}) {
  const format = audioFormat(options.audio);

  if (!format) {
    throw new NakamaApiError(
      `Unsupported audio format for ${options.audio.filename}.`,
      400
    );
  }

  const response = await fetch(`${options.baseUrl}/chat/completions`, {
    body: JSON.stringify({
      messages: [
        {
          content: [
            {
              text: "Transcribe this audio word for word. Reply with the transcript only.",
              type: "text",
            },
            {
              input_audio: {
                data: Buffer.from(options.audio.bytes).toString("base64"),
                format,
              },
              type: "input_audio",
            },
          ],
          role: "user",
        },
      ],
      model: options.model,
    }),
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
    signal: options.signal,
  });

  if (!response.ok) {
    await response.body?.cancel();
    throw new NakamaApiError(
      `Audio transcription failed (${response.status}).`,
      502
    );
  }

  const payload = ChatTranscriptionResponseSchema.safeParse(
    await response.json()
  );

  const text = payload.success
    ? payload.data.choices[0]?.message.content?.trim()
    : "";

  if (!text) {
    throw new NakamaApiError("Audio transcription returned empty text.", 502);
  }

  return text;
}

export async function transcribeAudio(options: {
  provider: Pick<ProviderInstance, "type" | "apiKey" | "baseUrl">;
  model: string;
  audio: { bytes: Uint8Array; filename: string; mediaType: string };
  signal?: AbortSignal;
}): Promise<string> {
  const { provider, model, audio, signal } = options;

  if (provider.type === "openrouter") {
    return transcribeWithChat({
      apiKey: provider.apiKey,
      audio,
      baseUrl: normalizeBaseUrl(
        provider.baseUrl?.trim() || "https://openrouter.ai/api/v1"
      ),
      model,
      signal,
    });
  }

  // Self-hosted backends that speak the OpenAI-compatible transcriptions API
  // surface as `openai_compatible` with a baseUrl (e.g. local Whisper),
  // alongside first-party `openai`. OpenRouter goes through chat above. Other
  // types are not supported and stay rejected even when they carry an apiKey.
  if (
    provider.type !== "openai" &&
    (provider.type !== "openai_compatible" || !provider.baseUrl?.trim())
  ) {
    throw new NakamaApiError(
      `Transcription is not supported for provider ${provider.type}.`,
      400
    );
  }

  const baseUrl = normalizeBaseUrl(
    provider.baseUrl ?? "https://api.openai.com/v1"
  );

  const body = new FormData();
  body.append(
    "file",
    new Blob([new Uint8Array(audio.bytes)], { type: audio.mediaType }),
    audio.filename
  );
  body.append("model", model);

  const response = await fetch(`${baseUrl}/audio/transcriptions`, {
    body,
    headers: { Authorization: `Bearer ${provider.apiKey}` },
    method: "POST",
    signal,
  });

  if (!response.ok) {
    throw new NakamaApiError(
      `Audio transcription failed (${response.status}).`,
      502
    );
  }

  const payload = TranscriptionResponseSchema.safeParse(await response.json());

  if (!(payload.success && payload.data.text.trim())) {
    throw new NakamaApiError("Audio transcription returned empty text.", 502);
  }

  return payload.data.text.trim();
}
