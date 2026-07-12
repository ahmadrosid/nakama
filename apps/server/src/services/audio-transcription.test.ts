import { describe, expect, test } from "bun:test";
import type { UserConfig } from "@nakama/core";
import { resolveTranscriptionProviderSelection } from "./audio-transcription";

describe("resolveTranscriptionProviderSelection", () => {
  test("returns null when transcription model is not configured", () => {
    expect(
      resolveTranscriptionProviderSelection({ defaultProviderId: null, providers: [] }),
    ).toBeNull();
  });

  test("resolves configured OpenAI whisper model", () => {
    const config: UserConfig = {
      defaultProviderId: "p-openai",
      transcriptionModel: "p-openai::whisper-1",
      providers: [
        {
          id: "p-openai",
          type: "openai",
          label: "OpenAI",
          apiKey: "key",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    };

    const resolved = resolveTranscriptionProviderSelection(config);
    expect(resolved?.model).toBe("whisper-1");
    expect(resolved?.instance.id).toBe("p-openai");
  });

  test("rejects non-openai provider", () => {
    const config: UserConfig = {
      defaultProviderId: "p-gemini",
      transcriptionModel: "p-gemini::whisper-1",
      providers: [
        {
          id: "p-gemini",
          type: "gemini",
          label: "Gemini",
          apiKey: "key",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    };

    expect(() => resolveTranscriptionProviderSelection(config)).toThrow(
      "Audio transcription requires an OpenAI provider.",
    );
  });

  test("rejects unsupported chat model", () => {
    const config: UserConfig = {
      defaultProviderId: "p-openai",
      transcriptionModel: "p-openai::gpt-4o-mini",
      providers: [
        {
          id: "p-openai",
          type: "openai",
          label: "OpenAI",
          apiKey: "key",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    };

    expect(() => resolveTranscriptionProviderSelection(config)).toThrow(
      'Configured audio transcription model "gpt-4o-mini" is not supported.',
    );
  });
});
