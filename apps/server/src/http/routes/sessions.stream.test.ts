import { describe, expect, test } from "bun:test";
import type { AgentChatSession } from "@nakama/agent";
import { sessionTurnRegistry } from "../../services/session-turn-registry";
import { streamMessage, streamTurnSubscribe } from "../shared";

/** Stands in for a turn stuck in a long tool run: it only settles when cancelled. */
function createCancellableSession(): {
  session: AgentChatSession;
  sawSignal: () => AbortSignal | undefined;
} {
  let signal: AbortSignal | undefined;

  const session = {
    getContextUsage: () => null,
    sendStream: (
      _input: unknown,
      _handlers: unknown,
      options?: { signal?: AbortSignal }
    ) =>
      new Promise<string>((_resolve, reject) => {
        signal = options?.signal;

        if (!signal) {
          return;
        }

        signal.addEventListener("abort", () => reject(signal?.reason), {
          once: true,
        });
      }),
  } as unknown as AgentChatSession;

  return { sawSignal: () => signal, session };
}

async function waitForTurnToEnd(sessionId: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (!sessionTurnRegistry.isActive(sessionId)) {
      return;
    }

    await Bun.sleep(10);
  }
}

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

describe("streamMessage cancellation", () => {
  test("client abort ends the turn so the next message is not a 409", async () => {
    const sessionId = `session_abort_test_${Date.now()}`;
    const { session, sawSignal } = createCancellableSession();
    const request = new AbortController();

    expect(sessionTurnRegistry.beginTurn(sessionId).started).toBe(true);
    streamMessage(
      sessionId,
      session,
      { message: "run something long" },
      undefined,
      request.signal
    );

    await Bun.sleep(10);
    expect(sawSignal()).toBeDefined();
    expect(sessionTurnRegistry.isActive(sessionId)).toBe(true);

    // This is Discord /stop: the worker aborts its fetch, so the server request aborts.
    request.abort();
    await waitForTurnToEnd(sessionId);

    expect(sessionTurnRegistry.isActive(sessionId)).toBe(false);
    // The follow-up message the user sends right after /stop.
    expect(sessionTurnRegistry.beginTurn(sessionId).started).toBe(true);
    sessionTurnRegistry.endTurn(sessionId, { reply: "ok", type: "done" });
  });

  test("cancelling the response stream also ends the turn", async () => {
    const sessionId = `session_cancel_test_${Date.now()}`;
    const { session } = createCancellableSession();

    expect(sessionTurnRegistry.beginTurn(sessionId).started).toBe(true);
    const response = streamMessage(sessionId, session, { message: "hi" });

    await Bun.sleep(10);
    await response.body?.cancel();
    await waitForTurnToEnd(sessionId);

    expect(sessionTurnRegistry.isActive(sessionId)).toBe(false);
  });
});

describe("streamMessage timeout", () => {
  test("a provider that goes quiet is timed out, aborted, and reported as a timeout", async () => {
    const sessionId = `session_timeout_test_${Date.now()}`;
    const { session, sawSignal } = createCancellableSession();

    expect(sessionTurnRegistry.beginTurn(sessionId).started).toBe(true);
    const response = streamMessage(
      sessionId,
      session,
      { message: "hi" },
      undefined,
      undefined,
      10
    );

    const body = await new Response(response.body).text();
    await waitForTurnToEnd(sessionId);

    expect(body).toContain("timed out after");
    // The deadline aborts the turn, so this is the message the user would get
    // if the abort were mistaken for a cancel.
    expect(body).not.toContain("Turn cancelled.");
    // Nothing else stops the provider request once the race is lost.
    expect(sawSignal()?.aborted).toBe(true);
    expect(sessionTurnRegistry.isActive(sessionId)).toBe(false);
    // The session is usable again rather than 409ing for the rest of the window.
    expect(sessionTurnRegistry.beginTurn(sessionId).started).toBe(true);
    sessionTurnRegistry.endTurn(sessionId, { reply: "ok", type: "done" });
  });

  test("a completed turn clears its deadline instead of leaving a timer behind", async () => {
    const sessionId = `session_deadline_test_${Date.now()}`;
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    const pending = new Set<ReturnType<typeof setTimeout>>();
    // Distinctive enough that only the stream deadline matches.
    const deadlineMs = 300_000;

    globalThis.setTimeout = ((
      handler: TimerHandler,
      delay?: number,
      ...rest: unknown[]
    ) => {
      const handle = realSetTimeout(
        handler as () => void,
        delay,
        ...(rest as [])
      );
      if (delay === deadlineMs) {
        pending.add(handle);
      }
      return handle;
    }) as typeof globalThis.setTimeout;
    globalThis.clearTimeout = ((handle?: ReturnType<typeof setTimeout>) => {
      if (handle !== undefined) {
        pending.delete(handle);
      }
      realClearTimeout(handle);
    }) as typeof globalThis.clearTimeout;

    try {
      const session = {
        getContextUsage: () => null,
        sendStream: () => Promise.resolve("done"),
      } as unknown as AgentChatSession;

      expect(sessionTurnRegistry.beginTurn(sessionId).started).toBe(true);
      const response = streamMessage(
        sessionId,
        session,
        { message: "hi" },
        undefined,
        undefined,
        deadlineMs
      );

      await new Response(response.body).text();
      await waitForTurnToEnd(sessionId);

      expect(pending.size).toBe(0);
    } finally {
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
      for (const handle of pending) {
        realClearTimeout(handle);
      }
    }
  });
});
