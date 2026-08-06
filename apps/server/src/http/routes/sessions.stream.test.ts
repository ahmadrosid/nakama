import { describe, expect, test } from "bun:test";
import { sessionTurnRegistry } from "../../services/session-turn-registry";
import { streamTurnSubscribe } from "../shared";

describe("streamTurnSubscribe", () => {
  test("returns null when no active turn", () => {
    expect(streamTurnSubscribe("missing_session")).toBeNull();
  });

  test("replays buffered events to subscribe connection", async () => {
    const sessionId = `session_stream_test_${Date.now()}`;

    sessionTurnRegistry.beginTurn(sessionId);
    sessionTurnRegistry.publish(sessionId, { type: "chunk", delta: "hello" });

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

    sessionTurnRegistry.endTurn(sessionId, { type: "done", reply: "hello" });
  });
});
