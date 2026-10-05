import { describe, expect, test } from "bun:test";
import type { UserConfig } from "@nakama/core";
import { resolveTranscriptionProviderSelection } from "./audio-transcription";

describe("resolveTranscriptionProviderSelection", () => {
  test("returns null when transcription model is not configured", () => {
    expect(
      resolveTranscriptionProviderSelection({
        defaultProviderId: null,
        providers: [],
      })
    ).toBeNull();
  });

  test("resolves configured OpenAI whisper model", () => {
    const config: UserConfig = {
      defaultProviderId: "p-openai",
      providers: [
        {
          apiKey: "key",
          createdAt: "2026-01-01T00:00:00.000Z",
          id: "p-openai",
          label: "OpenAI",
          type: "openai",
        },
      ],
      transcriptionModel: "p-openai::whisper-1",
    };

    const resolved = resolveTranscriptionProviderSelection(config);
    expect(resolved?.model).toBe("whisper-1");
    expect(resolved?.instance.id).toBe("p-openai");
  });

  test("rejects non-openai provider", () => {
    const config: UserConfig = {
      defaultProviderId: "p-gemini",
      providers: [
        {
          apiKey: "test-key",
          createdAt: "2026-01-01T00:00:00.000Z",
          id: "p-gemini",
          label: "Gemini",
          type: "gemini",
        },
      ],
      transcriptionModel: "p-gemini::whisper-1",
    };

    expect(() => resolveTranscriptionProviderSelection(config)).toThrow(
      "Audio transcription requires an OpenAI or OpenAI-compatible provider with a base URL."
    );
  });

  test("resolves openai_compatible provider with a baseUrl", () => {
    const config: UserConfig = {
      defaultProviderId: "p-local",
      providers: [
        {
          apiKey: "local-key",
          baseUrl: "http://100.64.0.1:8000/v1",
          createdAt: "2026-01-01T00:00:00.000Z",
          id: "p-local",
          label: "Local Whisper",
          type: "openai_compatible",
        },
      ],
      transcriptionModel: "p-local::whisper-large-v3",
    };

    const resolved = resolveTranscriptionProviderSelection(config);
    expect(resolved?.model).toBe("whisper-large-v3");
    expect(resolved?.instance.type).toBe("openai_compatible");
  });

  test("rejects openai_compatible provider without a baseUrl", () => {
    const config: UserConfig = {
      defaultProviderId: "p-local",
      providers: [
        {
          apiKey: "local-key",
          createdAt: "2026-01-01T00:00:00.000Z",
          id: "p-local",
          label: "Local Whisper",
          type: "openai_compatible",
        },
      ],
      transcriptionModel: "p-local::whisper-large-v3",
    };

    expect(() => resolveTranscriptionProviderSelection(config)).toThrow(
      "Audio transcription requires an OpenAI or OpenAI-compatible provider with a base URL."
    );
  });

  test("rejects unsupported chat model", () => {
    const config: UserConfig = {
      defaultProviderId: "p-openai",
      providers: [
        {
          apiKey: "key",
          createdAt: "2026-01-01T00:00:00.000Z",
          id: "p-openai",
          label: "OpenAI",
          type: "openai",
        },
      ],
      transcriptionModel: "p-openai::gpt-4o-mini",
    };

    expect(() => resolveTranscriptionProviderSelection(config)).toThrow(
      'Configured audio transcription model "gpt-4o-mini" is not supported.'
    );
  });
});
