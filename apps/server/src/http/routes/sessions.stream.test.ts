import { describe, expect, test } from "bun:test";
import { sessionTurnRegistry } from "../../services/session-turn-registry";
import { createTurnStream, streamTurnSubscribe } from "../shared";

describe("createTurnStream", () => {
  test("sends every event as SSE and closes when the turn is done", async () => {
    const stream = createTurnStream();
    stream.onEvent({ delta: "hi", type: "chunk" });

    const body = new Response(stream.respond(Promise.resolve()).body).text();

    stream.onEvent({ reply: "hi", type: "done" });

    expect(await body).toBe(
      'data: {"delta":"hi","type":"chunk"}\n\ndata: {"reply":"hi","type":"done"}\n\n'
    );
  });

  test("cancelling the response aborts the turn signal", async () => {
    const stream = createTurnStream();
    const response = stream.respond(new Promise(() => undefined));

    await response.body?.cancel();

    expect(stream.signal.aborted).toBe(true);
  });
});

describe("streamTurnSubscribe", () => {
  test("returns null when no active turn", () => {
    expect(streamTurnSubscribe("missing_session")).toBeNull();
  });

  test("replays buffered events to subscribe connection", async () => {
    const sessionId = `session_stream_test_${Date.now()}`;

    sessionTurnRegistry.beginTurn(sessionId);
    sessionTurnRegistry.publish(sessionId, { delta: "hello", type: "chunk" });

    const response = streamTurnSubscribe(sessionId);
    expect(response).not.toBeNull();

    const reader = response!.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      if (buffer.includes('"delta":"hello"')) {
        break;
      }
    }

    expect(buffer).toContain('"delta":"hello"');

    sessionTurnRegistry.endTurn(sessionId, { reply: "hello", type: "done" });
  });
});
