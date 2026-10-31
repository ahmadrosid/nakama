import { describe, expect, spyOn, test } from "bun:test";
import { NakamaApiError, type StreamEvent } from "@nakama/core";
import type { StoredSessionRecord } from "@nakama/db";
import { createOpenAICompatibleProvider } from "../providers/openai-compatible";
import { asTestFetch, streamFromChunks } from "../providers/test-helpers";
import { SessionTurnRegistry } from "./session-turn-registry";
import {
  type TurnChat,
  type TurnEnd,
  TurnRunner,
  type TurnRunnerDeps,
} from "./turn-runner";

const ORG_ID = "org_test";

const SESSION_ID = "s1";

type Handlers = Parameters<TurnChat["sendStream"]>[1];

/** What the fake chat saw of the turn. */
interface Seen {
  sent: number;
  signal?: AbortSignal;
}

function record(overrides: Partial<StoredSessionRecord> = {}) {
  return {
    agentQuestionnaire: null,
    agentTodos: [],
    channel: "web",
    codingWorkspaceRoot: null,
    createdAt: "2026-10-31T00:00:00.000Z",
    id: SESSION_ID,
    model: null,
    parentSessionId: null,
    profileId: "profile_default",
    thinkingEffort: null,
    title: null,
    userId: "owner",
    ...overrides,
  } satisfies StoredSessionRecord;
}

/** A chat whose turn is `run`; it sees the handlers and the turn signal. */
function chat(
  run: (handlers: Handlers, signal: AbortSignal | undefined) => Promise<string>
) {
  const seen: Seen = { sent: 0 };

  const fake: TurnChat = {
    getContextUsage: () => null,
    getTurnUsage: () => null,
    sendStream: (_input, handlers, options) => {
      seen.sent += 1;
      seen.signal = options?.signal;

      return run(handlers, options?.signal);
    },
  };

  return { fake, seen };
}

/** Settles only when the turn is aborted, like a long tool run. */
function untilAborted(
  _handlers: Handlers,
  signal: AbortSignal | undefined
): Promise<string> {
  return new Promise((_, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
  });
}

function setup(
  turnChat: TurnChat | null,
  overrides: Partial<TurnRunnerDeps> = {}
) {
  const registry = new SessionTurnRegistry();
  const hooks: string[] = [];
  const reported: unknown[] = [];

  const runner = new TurnRunner({
    firstTokenTimeoutMs: 0,
    loadRecord: async () => record(),
    prepare: async () => undefined,
    registry,
    reportError: async (error) => {
      reported.push(error);
    },
    scheduleSkillReview: () => hooks.push("skill_review"),
    scheduleTitle: () => hooks.push("title"),
    sessions: { get: async () => turnChat },
    timeoutMs: 5000,
    ...overrides,
  });

  const run = async (options: Parameters<TurnRunner["start"]>[3] = {}) => {
    const turn = await runner.start(
      SESSION_ID,
      ORG_ID,
      { message: "hi" },
      options
    );

    if (turn.status !== "started") {
      throw new Error(`Turn did not start: ${turn.status}`);
    }

    return turn.done;
  };

  return { hooks, registry, reported, run, runner };
}

describe("TurnRunner", () => {
  test("answers not_found without taking the lock", async () => {
    const { registry, runner } = setup(null, {
      loadRecord: async () => null,
    });

    expect(
      (await runner.start(SESSION_ID, ORG_ID, { message: "hi" })).status
    ).toBe("not_found");
    expect(registry.isActive(SESSION_ID)).toBe(false);
  });

  test("answers busy while another turn holds the session", async () => {
    const { fake } = chat(async () => "ok");
    const { registry, runner } = setup(fake);
    registry.beginTurn(SESSION_ID);

    expect(
      (await runner.start(SESSION_ID, ORG_ID, { message: "hi" })).status
    ).toBe("busy");
  });

  test("a done turn streams its events, frees the lock and runs both hooks", async () => {
    const { fake } = chat(async (handlers) => {
      handlers.onChunk?.("he");

      return "hello";
    });

    const { hooks, registry, run } = setup(fake);
    const events: StreamEvent[] = [];

    const end = await run({ onEvent: (event) => events.push(event) });

    expect(end).toMatchObject({ kind: "done", reply: "hello" });
    expect(events.map((event) => event.type)).toEqual(["chunk", "done"]);
    expect(registry.isActive(SESSION_ID)).toBe(false);
    expect(hooks).toEqual(["title", "skill_review"]);
  });

  test("a child chat gets a title but no skill review", async () => {
    const { fake } = chat(async () => "hello");

    const { hooks, run } = setup(fake, {
      loadRecord: async () => record({ parentSessionId: "parent" }),
    });

    await run();

    expect(hooks).toEqual(["title"]);
  });

  test("a failed turn is reported, keeps its status and frees the lock", async () => {
    const { fake } = chat(async () => {
      throw new Error("disk full");
    });

    const { hooks, registry, reported, run } = setup(fake);
    const end = await run();

    expect(end).toMatchObject({ kind: "error", reason: "failed", status: 500 });
    expect(reported).toHaveLength(1);
    expect(registry.isActive(SESSION_ID)).toBe(false);
    expect(hooks).toEqual(["title"]);
  });

  test("a 4xx refusal is not reported", async () => {
    const { fake } = chat(async () => {
      throw new NakamaApiError("Forbidden", 403);
    });

    const { reported, run } = setup(fake);

    expect(await run()).toMatchObject({ reason: "failed", status: 403 });
    expect(reported).toHaveLength(0);
  });

  test("a prepare failure rejects the start and frees the lock", async () => {
    const { fake, seen } = chat(async () => "never");

    const { registry, runner } = setup(fake, {
      prepare: async () => {
        throw new NakamaApiError("Select a configured model.", 400);
      },
    });

    await expect(
      runner.start(SESSION_ID, ORG_ID, { message: "hi" })
    ).rejects.toMatchObject({ status: 400 });
    expect(registry.isActive(SESSION_ID)).toBe(false);
    expect(seen.sent).toBe(0);
  });

  test("the caller's signal cancels the turn and nothing is reported", async () => {
    const { fake, seen } = chat(untilAborted);
    const { reported, run } = setup(fake);
    const caller = new AbortController();

    const done = run({ signal: caller.signal });
    await Bun.sleep(5);
    caller.abort();

    expect(await done).toMatchObject({ reason: "cancelled" });
    expect(seen.signal?.aborted).toBe(true);
    expect(reported).toHaveLength(0);
  });

  test("close_session stops the turn through the registry", async () => {
    const { fake } = chat(untilAborted);
    const { registry, run } = setup(fake);

    const done = run();
    await Bun.sleep(5);
    registry.stopTurn(SESSION_ID);

    expect(await done).toMatchObject({ reason: "cancelled" });
    expect(registry.isActive(SESSION_ID)).toBe(false);
  });

  test("a stop sent while the chat is prepared cancels the turn", async () => {
    const { fake, seen } = chat(async () => "never");
    let registry: SessionTurnRegistry | undefined;

    const setupResult = setup(fake, {
      prepare: async () => {
        registry?.stopTurn(SESSION_ID);
      },
    });

    registry = setupResult.registry;

    expect(await setupResult.run()).toMatchObject({ reason: "cancelled" });
    expect(seen.sent).toBe(0);
    expect(registry.isActive(SESSION_ID)).toBe(false);
  });

  test("a throwing hook keeps the finished reply", async () => {
    const { fake } = chat(async () => "hello");

    const { registry, reported, run } = setup(fake, {
      scheduleTitle: () => {
        throw new Error("title service down");
      },
    });

    expect(await run()).toMatchObject({ kind: "done", reply: "hello" });
    expect(reported).toHaveLength(1);
    expect(registry.isActive(SESSION_ID)).toBe(false);
  });

  test("a caller that left before the turn began sends nothing and runs no hooks", async () => {
    const { fake, seen } = chat(async () => "never");
    const { hooks, registry, run } = setup(fake);

    expect(await run({ signal: AbortSignal.abort() })).toMatchObject({
      reason: "cancelled",
    });
    expect(seen.sent).toBe(0);
    expect(hooks).toEqual([]);
    expect(registry.isActive(SESSION_ID)).toBe(false);
  });

  test("a provider that goes quiet times out and is aborted", async () => {
    const { fake, seen } = chat(untilAborted);
    const { reported, registry, run } = setup(fake);

    const end = await run({ timeoutMs: 10 });

    expect(end).toMatchObject({ reason: "timeout", status: 504 });
    // Nothing else stops the provider request once the race is lost.
    expect(seen.signal?.aborted).toBe(true);
    expect(reported).toHaveLength(1);
    expect(registry.isActive(SESSION_ID)).toBe(false);
  });

  test("a silent provider is released on the first-token deadline", async () => {
    const { fake } = chat(untilAborted);
    const { run } = setup(fake, { firstTokenTimeoutMs: 20 });
    const startedAt = performance.now();

    expect(await run()).toMatchObject({ reason: "stalled" });
    // The overall deadline is 5s, so this ended on the first-token one.
    expect(performance.now() - startedAt).toBeLessThan(2000);
  });

  test("a provider that has produced output keeps the full deadline", async () => {
    const { fake } = chat((handlers, signal) => {
      handlers.onChunk?.("working");

      return untilAborted(handlers, signal);
    });

    const { run } = setup(fake, { firstTokenTimeoutMs: 20 });
    const startedAt = performance.now();

    expect(await run({ timeoutMs: 100 })).toMatchObject({ reason: "timeout" });
    // It outlived the 20ms first-token deadline and ended on the 100ms one.
    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(90);
  });

  test("a completed turn clears its deadline", async () => {
    const deadlineMs = 300_000;
    const timeouts = spyOn(globalThis, "setTimeout");
    const clears = spyOn(globalThis, "clearTimeout");

    try {
      const { fake } = chat(async () => "done");
      await setup(fake).run({ timeoutMs: deadlineMs });

      const index = timeouts.mock.calls.findIndex(
        ([, delay]) => delay === deadlineMs
      );

      const handle = timeouts.mock.results[index];
      expect(handle?.type).toBe("return");
      expect(clears).toHaveBeenCalledWith(handle?.value);
    } finally {
      timeouts.mockRestore();
      clears.mockRestore();
    }
  });

  test("frees the lock and reports it when the last event cannot be published", async () => {
    const { fake } = chat(async () => "done");
    const { registry, reported, run } = setup(fake);
    const publish = registry.publish.bind(registry);

    spyOn(registry, "publish").mockImplementation((id, event) => {
      if (event.type === "done") {
        throw new Error("transport dropped");
      }

      publish(id, event);
    });

    expect(await run()).toMatchObject({ kind: "done", reply: "done" });
    expect(registry.isActive(SESSION_ID)).toBe(false);
    expect(reported).toHaveLength(1);
  });

  test("a provider stream that fails shows the provider's message", async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = asTestFetch(
      async () =>
        new Response(
          streamFromChunks([
            'data: {"choices":[{"delta":{"content":""},"finish_reason":"error"}],"error":{"message":"upstream error"}}\n\n',
          ]),
          { headers: { "Content-Type": "text/event-stream" } }
        )
    );

    const provider = createOpenAICompatibleProvider({
      apiKey: "test-key",
      baseUrl: "https://api.netraruntime.com/v1",
      displayName: "Netra Runtime",
      model: "deepseek/deepseek-v4.1-flash",
      providerName: "netra",
      supportsThinking: false,
    });

    try {
      const { fake } = chat((handlers) =>
        provider
          .streamChat({ messages: [], system: "" }, handlers)
          .then((result) => result.content)
      );

      const end: TurnEnd = await setup(fake).run();

      expect(end.kind === "error" && end.message).toContain("upstream error");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
