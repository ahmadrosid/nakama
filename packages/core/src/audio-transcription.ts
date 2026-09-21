import { NakamaApiError } from "./api-error";
import { normalizeBaseUrl } from "./compatible-provider-config";
import type { ProviderInstance } from "./user-config";

export async function transcribeAudio(options: {
  provider: Pick<ProviderInstance, "type" | "apiKey" | "baseUrl">;
  model: string;
  audio: { bytes: Uint8Array; filename: string; mediaType: string };
  signal?: AbortSignal;
}): Promise<string> {
  const { provider, model, audio, signal } = options;
  if (provider.type !== "openai") {
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
  const payload = (await response.json()) as { text?: unknown };
  if (typeof payload.text !== "string" || !payload.text.trim()) {
    throw new NakamaApiError("Audio transcription returned empty text.", 502);
  }
  return payload.text.trim();
}
