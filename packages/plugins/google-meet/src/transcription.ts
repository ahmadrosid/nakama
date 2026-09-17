export interface TranscriptSegment {
  id: string;
  receivedAt: number;
  text: string;
}

export interface TranscriptionSession {
  close(): void;
  finish(): Promise<void>;
  push(audio: Uint8Array): void;
}

export interface TranscriptionProvider {
  connect(options: {
    apiKey: string;
    model: string;
    signal: AbortSignal;
    onSegment(segment: TranscriptSegment): void;
    onError(error: Error): void;
  }): Promise<TranscriptionSession>;
}

export function transcriptionConfig(value: Record<string, unknown>) {
  const provider = value.provider ?? "openai";
  const model = value.model ?? "gpt-transcribe";
  if (provider !== "openai" || model !== "gpt-transcribe") {
    throw new Error("Unsupported transcription provider or model");
  }
  if (
    typeof value.apiKey !== "string" ||
    !value.apiKey.trim() ||
    value.apiKey.length > 4096
  ) {
    throw new Error("An OpenAI API key is required for transcription");
  }
  return { apiKey: value.apiKey.trim(), model, provider };
}

// The API can complete later turns first. Keep audio order, not arrival order.
export class OpenAITranscript {
  private readonly order: string[] = [];
  private readonly completed = new Map<string, TranscriptSegment>();
  private readonly seen = new Set<string>();

  accept(event: Record<string, unknown>) {
    if (
      event.type === "conversation.item.input_audio_transcription.failed" ||
      event.type === "error"
    ) {
      throw new Error(
        "Transcription failed; check the API key, model access, and API balance"
      );
    }
    const id = typeof event.item_id === "string" ? event.item_id : undefined;
    if (!id) {
      return;
    }
    if (event.type === "input_audio_buffer.committed" && !this.seen.has(id)) {
      this.seen.add(id);
      this.order.push(id);
    }
    if (
      event.type === "conversation.item.input_audio_transcription.completed" &&
      typeof event.transcript === "string" &&
      this.order.includes(id)
    ) {
      this.completed.set(id, {
        id,
        receivedAt: Date.now(),
        text: event.transcript.trim(),
      });
    }
  }

  drain(): TranscriptSegment[] {
    const result: TranscriptSegment[] = [];
    while (this.order[0] && this.completed.has(this.order[0])) {
      const id = this.order.shift()!;
      const segment = this.completed.get(id)!;
      this.completed.delete(id);
      if (segment.text) {
        result.push(segment);
      }
    }
    return result;
  }

  get pending() {
    return this.order.length;
  }
}

const openai: TranscriptionProvider = {
  async connect({ apiKey, model, signal, onSegment, onError }) {
    signal.throwIfAborted();
    // DOM typings omit Bun's server-side headers option.
    const Socket = WebSocket as unknown as {
      new (url: string, options: Bun.WebSocketOptions): WebSocket;
    };
    const socket = new Socket(
      "wss://api.openai.com/v1/realtime?intent=transcription",
      {
        headers: { Authorization: `Bearer ${apiKey}` },
      }
    );
    const transcript = new OpenAITranscript();
    let closing = false;
    let ready = false;
    let failure: Error | undefined;
    let sentAudio = false;
    let finalCommit = false;
    let finishing = false;
    let lastEvent = Date.now();
    let resolveReady: () => void;
    let rejectReady: (error: Error) => void;
    const connected = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const fail = (error: Error) => {
      if (failure || closing) {
        return;
      }
      failure = error;
      rejectReady(error);
      if (ready) {
        onError(error);
      }
    };
    const timeout = setTimeout(
      () => fail(new Error("Transcription connection timed out")),
      15_000
    );
    const abort = () => fail(new Error("Transcription connection cancelled"));
    signal.addEventListener("abort", abort, { once: true });
    socket.addEventListener("open", () =>
      socket.send(
        JSON.stringify({
          session: {
            audio: {
              input: {
                format: { rate: 24_000, type: "audio/pcm" },
                transcription: { model },
                turn_detection: {
                  prefix_padding_ms: 300,
                  silence_duration_ms: 700,
                  threshold: 0.5,
                  type: "server_vad",
                },
              },
            },
            type: "transcription",
          },
          type: "session.update",
        })
      )
    );
    socket.addEventListener("message", (message) => {
      try {
        const event = JSON.parse(String(message.data));
        lastEvent = Date.now();
        if (event.type === "session.updated") {
          ready = true;
          resolveReady();
        }
        if (event.type === "input_audio_buffer.committed") {
          finalCommit = false;
        }
        if (
          event.type === "error" &&
          finishing &&
          event.error?.code === "input_audio_buffer_commit_empty"
        ) {
          finalCommit = false;
          return;
        }
        transcript.accept(event);
        for (const segment of transcript.drain()) {
          onSegment(segment);
        }
      } catch (error) {
        fail(
          error instanceof Error
            ? error
            : new Error("Invalid transcription response")
        );
      }
    });
    socket.addEventListener("error", () =>
      fail(new Error("Transcription connection failed"))
    );
    socket.addEventListener("close", () =>
      fail(new Error("Transcription connection closed unexpectedly"))
    );
    try {
      await connected;
    } catch (error) {
      closing = true;
      socket.close();
      throw error;
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
    return {
      close() {
        closing = true;
        socket.close();
      },
      async finish() {
        if (failure) {
          throw failure;
        }
        if (!sentAudio) {
          return;
        }
        finishing = true;
        finalCommit = true;
        lastEvent = Date.now();
        socket.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          if (failure) {
            throw failure;
          }
          if (
            !finalCommit &&
            transcript.pending === 0 &&
            Date.now() - lastEvent > 250
          ) {
            return;
          }
          await Bun.sleep(50);
        }
        throw new Error(
          "Timed out waiting for the final transcript; partial transcript was saved"
        );
      },
      push(audio) {
        if (failure) {
          throw failure;
        }
        if (
          socket.readyState !== WebSocket.OPEN ||
          socket.bufferedAmount > 2_400_000
        ) {
          throw new Error(
            "Transcription connection cannot keep up with meeting audio"
          );
        }
        sentAudio = true;
        socket.send(
          JSON.stringify({
            audio: Buffer.from(audio).toString("base64"),
            type: "input_audio_buffer.append",
          })
        );
      },
    };
  },
};

// Add another adapter here; browser capture and meeting storage only use the interface.
export const transcriptionProviders: Record<string, TranscriptionProvider> = {
  openai,
};
