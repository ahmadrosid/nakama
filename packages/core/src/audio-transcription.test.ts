import { expect, spyOn, test } from "bun:test";
import { transcribeAudio } from "./audio-transcription";

test("openai_compatible provider with a baseUrl is allowed", async () => {
  const request = spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    expect(String(url)).toBe("http://100.64.0.1:8000/v1/audio/transcriptions");
    return Response.json({ text: "Local transcript" });
  });
  try {
    expect(
      await transcribeAudio({
        audio: {
          bytes: new TextEncoder().encode("audio"),
          filename: "meeting.wav",
          mediaType: "audio/wav",
        },
        model: "whisper-large-v3",
        provider: {
          apiKey: "local-key",
          baseUrl: "http://100.64.0.1:8000/v1",
          type: "openai_compatible" as const,
        },
      })
    ).toBe("Local transcript");
  } finally {
    request.mockRestore();
  }
});

test("openai_compatible provider without a baseUrl is rejected", async () => {
  await expect(
    transcribeAudio({
      audio: {
        bytes: new TextEncoder().encode("audio"),
        filename: "meeting.wav",
        mediaType: "audio/wav",
      },
      model: "whisper-large-v3",
      provider: {
        apiKey: "local-key",
        type: "openai_compatible" as const,
      },
    })
  ).rejects.toMatchObject({ status: 400 });
});

test("transcription uses the configured provider endpoint, model, file, and cancellation", async () => {
  const signal = new AbortController().signal;
  const request = spyOn(globalThis, "fetch").mockImplementation(
    async (url, init) => {
      expect(url).toBe("https://example.com/v1/audio/transcriptions");
      expect(init?.headers).toEqual({ Authorization: "Bearer secret" });
      expect(init?.signal).toBe(signal);
      const body = init?.body as FormData;
      expect(body.get("model")).toBe("whisper-1");
      const file = body.get("file") as File;
      expect(file.name).toBe("meeting.wav");
      expect(await file.text()).toBe("audio");
      return Response.json({ text: " Meeting transcript " });
    }
  );
  try {
    const options = {
      audio: {
        bytes: new TextEncoder().encode("audio"),
        filename: "meeting.wav",
        mediaType: "audio/wav",
      },
      model: "whisper-1",
      provider: {
        apiKey: "secret",
        baseUrl: "https://example.com/v1/",
        type: "openai" as const,
      },
      signal,
    };
    expect(await transcribeAudio(options)).toBe("Meeting transcript");
    request.mockResolvedValue(new Response(null, { status: 503 }));
    await expect(transcribeAudio(options)).rejects.toMatchObject({
      status: 502,
    });
    request.mockResolvedValue(Response.json({ text: 123 }));
    await expect(transcribeAudio(options)).rejects.toMatchObject({
      status: 502,
    });
    await expect(
      transcribeAudio({
        ...options,
        provider: { apiKey: "secret", type: "gemini" },
      })
    ).rejects.toMatchObject({ status: 400 });
    expect(request).toHaveBeenCalledTimes(3);
  } finally {
    request.mockRestore();
  }
});
