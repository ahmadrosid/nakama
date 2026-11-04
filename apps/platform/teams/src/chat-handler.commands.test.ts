import { afterEach, describe, expect, test } from "bun:test";
import { formatClientError } from "@nakama/core/api-error";
import { resetActiveStreamsForTests } from "@nakama/core/channel-active-stream";
import { withTempHome } from "@nakama/core/channel-test-helpers";
import { activity, CONFIG, createHarness } from "./test-helpers";

// Spelled out: a formatter turns "\u00A0" into the bare character, which looks
// like a plain space.
const NO_BREAK_SPACE = String.fromCodePoint(0xa0);

/**
 * A turn that only ends when it is stopped, like a long tool run. `partial` is
 * streamed first, as a model that wrote some text before the tool call.
 */
function hangingTurn(partial = "") {
  let markStarted = () => {};

  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });

  const signals: AbortSignal[] = [];

  const onSend = (
    _message: string,
    signal?: AbortSignal,
    onChunk?: (delta: string) => void
  ) =>
    new Promise<string>((_resolve, reject) => {
      if (partial) {
        onChunk?.(partial);
      }

      const abort = () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      };

      if (signal) {
        signals.push(signal);
      }

      markStarted();

      // fetch rejects at once when its signal is already aborted.
      if (signal?.aborted) {
        abort();

        return;
      }

      signal?.addEventListener("abort", abort);
    });

  return { onSend, signals, started };
}

describe("teams commands", () => {
  // A turn left hanging by a failed test would hold the chat lock for the next.
  afterEach(() => {
    resetActiveStreamsForTests();
  });

  test("!help lists every command and starts no turn", async () => {
    await withTempHome("nakama-teams-commands-", async (homeDir) => {
      const { handle, replies, turns } = createHarness(homeDir);

      await handle(activity({ text: "!help" }));

      expect(turns).toEqual([]);
      expect(replies).toHaveLength(1);

      for (const command of ["!new", "!clear", "!stop", "!status", "!help"]) {
        expect(replies[0]?.text).toContain(command);
      }
    });
  });

  test("!new moves the next message to a new session", async () => {
    await withTempHome("nakama-teams-commands-", async (homeDir) => {
      const { createdSessions, handle, turns } = createHarness(homeDir);

      await handle(activity({ text: "first" }));
      await handle(activity({ text: "!new" }));
      await handle(activity({ text: "second" }));

      expect(createdSessions).toEqual(["session_1", "session_2"]);
      expect(turns).toEqual([
        { message: "first", sessionId: "session_1" },
        { message: "second", sessionId: "session_2" },
      ]);
    });
  });

  test("!clear clears the current session and keeps using it", async () => {
    await withTempHome("nakama-teams-commands-", async (homeDir) => {
      const { clearedSessions, createdSessions, handle, turns } =
        createHarness(homeDir);

      await handle(activity({ text: "first" }));
      await handle(activity({ text: "!clear" }));
      await handle(activity({ text: "second" }));

      expect(clearedSessions).toEqual(["session_1"]);
      expect(createdSessions).toEqual(["session_1"]);
      expect(turns.map((turn) => turn.sessionId)).toEqual([
        "session_1",
        "session_1",
      ]);
    });
  });

  test("a failed !new tells the user and keeps the current session", async () => {
    await withTempHome("nakama-teams-commands-", async (homeDir) => {
      let creates = 0;

      const { handle, replies, turns } = createHarness(homeDir, {
        beforeCreateSession: async () => {
          creates += 1;

          // The chat's first session is created; the one !new asks for fails.
          if (creates === 2) {
            throw new Error("connect ECONNREFUSED");
          }
        },
      });

      await handle(activity({ text: "first" }));
      await handle(activity({ text: "!new" }));
      await handle(activity({ text: "second" }));

      expect(replies).toHaveLength(3);
      expect(turns.map((turn) => turn.sessionId)).toEqual([
        "session_1",
        "session_1",
      ]);
    });
  });

  test("!clear before the first message answers, and that chat keeps one session", async () => {
    await withTempHome("nakama-teams-commands-", async (homeDir) => {
      const { clearedSessions, createdSessions, handle, replies, turns } =
        createHarness(homeDir);

      await handle(activity({ text: "!clear" }));
      await handle(activity({ text: "first" }));

      expect(replies).toHaveLength(2);
      expect(createdSessions).toHaveLength(1);
      expect(clearedSessions).toEqual(createdSessions);
      expect(turns).toEqual([
        { message: "first", sessionId: createdSessions[0] ?? "" },
      ]);
    });
  });

  test("!stop with nothing running answers and starts no turn", async () => {
    await withTempHome("nakama-teams-commands-", async (homeDir) => {
      const { handle, replies, turns } = createHarness(homeDir);

      await handle(activity({ text: "!stop" }));

      expect(turns).toEqual([]);
      expect(replies).toHaveLength(1);
    });
  });

  test("after a turn ends, !stop answers as if nothing ran", async () => {
    await withTempHome("nakama-teams-commands-", async (homeDir) => {
      const { handle, replies } = createHarness(homeDir);

      await handle(activity({ conversationId: "conv_fresh", text: "!stop" }));
      await handle(activity({ text: "hello" }));
      await handle(activity({ text: "!stop" }));

      expect(replies).toHaveLength(3);
      expect(replies[2]?.text).toBe(replies[0]?.text ?? "");
    });
  });

  test("!stop while a finished answer is being posted answers as if nothing ran", async () => {
    await withTempHome("nakama-teams-commands-", async (homeDir) => {
      let markPosting = () => {};

      let finishPosting = () => {};

      const posting = new Promise<void>((resolve) => {
        markPosting = resolve;
      });

      const posted = new Promise<void>((resolve) => {
        finishPosting = resolve;
      });

      const { handle, replies } = createHarness(homeDir, {
        beforeReply: async (text) => {
          if (text === "echo: hello") {
            markPosting();
            await posted;
          }
        },
      });

      await handle(activity({ conversationId: "conv_fresh", text: "!stop" }));
      const running = handle(activity({ text: "hello" }));
      await posting;
      await handle(activity({ text: "!stop" }));
      finishPosting();
      await running;

      // Both answers to !stop, then the answer itself with no stop notice.
      expect(replies).toHaveLength(3);
      expect(replies[1]?.text).toBe(replies[0]?.text ?? "");
    });
  });

  test("!stop cancels a running turn and keeps what it wrote so far", async () => {
    await withTempHome("nakama-teams-commands-", async (homeDir) => {
      const turn = hangingTurn("half an answer");

      const { handle, replies } = createHarness(homeDir, {
        onSend: turn.onSend,
      });

      const running = handle(activity({ text: "long job" }));
      await turn.started;
      await handle(activity({ text: "!stop" }));
      await running;

      expect(turn.signals.map((signal) => signal.aborted)).toEqual([true]);
      // The answer to !stop, the partial reply, then the turn's own stop notice.
      expect(replies).toHaveLength(3);
      expect(replies[1]?.text).toBe("half an answer");
    });
  });

  test("!stop also stops a turn queued behind the running one", async () => {
    await withTempHome("nakama-teams-commands-", async (homeDir) => {
      const turn = hangingTurn();

      const { handle, turns } = createHarness(homeDir, {
        onSend: (message, signal, onChunk) =>
          message === "long job"
            ? turn.onSend(message, signal, onChunk)
            : Promise.resolve(`echo: ${message}`),
      });

      const running = handle(activity({ text: "long job" }));
      await turn.started;
      const queued = handle(activity({ text: "queued" }));
      await handle(activity({ text: "!stop" }));
      await Promise.all([running, queued]);

      expect(turns.map((entry) => entry.message)).toEqual(["long job"]);
    });
  });

  // The turn holds the lock but is not registered yet while it rereads access,
  // so only the queue of waiting turns can reach it there.
  test("!stop while a turn rereads access stops it before any session exists", async () => {
    await withTempHome("nakama-teams-commands-", async (homeDir) => {
      let configReads = 0;

      let markReading = () => {};

      let finishReading = () => {};

      const reading = new Promise<void>((resolve) => {
        markReading = resolve;
      });

      const read = new Promise<void>((resolve) => {
        finishReading = resolve;
      });

      const { createdSessions, handle, replies, turns } = createHarness(
        homeDir,
        {
          loadConfig: async () => {
            configReads += 1;

            // The turn's read inside the lock.
            if (configReads === 2) {
              markReading();
              await read;
            }

            return CONFIG;
          },
        }
      );

      const running = handle(activity({ text: "hello" }));
      await reading;
      await handle(activity({ text: "!stop" }));
      finishReading();
      await running;

      expect(turns).toEqual([]);
      expect(createdSessions).toEqual([]);
      expect(replies).toHaveLength(2);
    });
  });

  test("a server error that lands during a stop is still told", async () => {
    await withTempHome("nakama-teams-commands-", async (homeDir) => {
      const failure = new Error("upstream returned 500");
      let markStarted = () => {};

      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });

      const { handle, replies } = createHarness(homeDir, {
        onSend: (_message, signal) =>
          new Promise<string>((_resolve, reject) => {
            markStarted();
            signal?.addEventListener("abort", () => reject(failure));
          }),
      });

      const running = handle(activity({ text: "long job" }));
      await started;
      await handle(activity({ text: "!stop" }));
      await running;

      expect(replies.map((reply) => reply.text)).toContain(
        formatClientError(failure)
      );
    });
  });

  test("an abort no stop asked for is told", async () => {
    await withTempHome("nakama-teams-commands-", async (homeDir) => {
      const failure = new Error("provider deadline passed");
      failure.name = "AbortError";

      const { handle, replies } = createHarness(homeDir, {
        onSend: () => Promise.reject(failure),
      });

      await handle(activity());

      expect(replies).toEqual([
        { conversationId: "conv_1", text: formatClientError(failure) },
      ]);
    });
  });

  test("!stop while the session is still being created stops the turn", async () => {
    await withTempHome("nakama-teams-commands-", async (homeDir) => {
      const turn = hangingTurn();

      let markCreating = () => {};

      let finishCreating = () => {};

      const creating = new Promise<void>((resolve) => {
        markCreating = resolve;
      });

      const created = new Promise<void>((resolve) => {
        finishCreating = resolve;
      });

      const { handle, replies } = createHarness(homeDir, {
        beforeCreateSession: async () => {
          markCreating();
          await created;
        },
        onSend: turn.onSend,
      });

      const running = handle(activity({ text: "long job" }));
      await creating;
      await handle(activity({ text: "!stop" }));
      finishCreating();
      await running;

      expect(turn.signals.map((signal) => signal.aborted)).toEqual([true]);
      expect(replies).toHaveLength(2);
    });
  });

  // The running turn holds the chat lock, so a command that waited for the
  // lock without stopping the turn first would never run.
  test("!new stops a running turn instead of waiting behind it", async () => {
    await withTempHome("nakama-teams-commands-", async (homeDir) => {
      const turn = hangingTurn();

      const { createdSessions, handle } = createHarness(homeDir, {
        onSend: turn.onSend,
      });

      const running = handle(activity({ text: "long job" }));
      await turn.started;
      await handle(activity({ text: "!new" }));
      await running;

      expect(turn.signals.map((signal) => signal.aborted)).toEqual([true]);
      expect(createdSessions).toEqual(["session_1", "session_2"]);
    });
  });

  test("!status reports the agent, provider, model and session", async () => {
    await withTempHome("nakama-teams-commands-", async (homeDir) => {
      const { handle, replies, turns } = createHarness(homeDir);

      await handle(activity({ text: "hello" }));
      await handle(activity({ text: "!status" }));

      expect(turns).toHaveLength(1);

      const status = replies.at(-1)?.text ?? "";

      for (const value of [
        "Helper",
        "test-provider",
        "test-model",
        "session_",
      ]) {
        expect(status).toContain(value);
      }
    });
  });

  test("!status with no provider configured answers without asking for models", async () => {
    await withTempHome("nakama-teams-commands-", async (homeDir) => {
      let modelRequests = 0;

      const { handle, replies } = createHarness(homeDir, {
        beforeGetModels: async () => {
          modelRequests += 1;
        },
        health: async () => ({ ok: true, providerConfigured: false }),
      });

      await handle(activity({ text: "!status" }));

      expect(modelRequests).toBe(0);
      expect(replies).toHaveLength(1);
      expect(replies[0]?.text).not.toContain("test-model");
    });
  });

  test("!status still answers when the server cannot be reached", async () => {
    await withTempHome("nakama-teams-commands-", async (homeDir) => {
      const { handle, replies, turns } = createHarness(homeDir, {
        health: () => Promise.reject(new Error("connect ECONNREFUSED")),
      });

      await handle(activity({ text: "!status" }));

      expect(turns).toEqual([]);
      expect(replies).toHaveLength(1);
    });
  });

  // !status waits on the server; a slow answer must not hold up the chat.
  test("a slow !status holds up no other message", async () => {
    await withTempHome("nakama-teams-commands-", async (homeDir) => {
      let markAsking = () => {};

      let finishAsking = () => {};

      const asking = new Promise<void>((resolve) => {
        markAsking = resolve;
      });

      const answered = new Promise<void>((resolve) => {
        finishAsking = resolve;
      });

      const { handle, replies } = createHarness(homeDir, {
        beforeGetModels: async () => {
          markAsking();
          await answered;
        },
      });

      // Its own chat, so a failure here cannot hold another test's lock.
      const chat = { conversationId: "conv_slow_status" };
      const status = handle(activity({ ...chat, text: "!status" }));
      await asking;

      const hello = handle(activity({ ...chat, text: "hello" }));

      // Raced instead of awaited, so a failure still releases !status below.
      const helloFirst = await Promise.race([
        hello.then(() => true),
        Bun.sleep(1000).then(() => false),
      ]);

      finishAsking();
      await Promise.all([status, hello]);

      expect(helloFirst).toBe(true);
      expect(replies[0]?.text).toBe("echo: hello");
      expect(replies).toHaveLength(2);
    });
  });

  // Whitespace around a command, a line break or a no-break space included.
  for (const [name, text] of [
    ["spaces and a line break", "  !help\r\n"],
    ["a no-break space", `${NO_BREAK_SPACE}!help`],
  ] as const) {
    test(`a command with ${name} around it is still a command`, async () => {
      await withTempHome("nakama-teams-commands-", async (homeDir) => {
        const { handle, replies, turns } = createHarness(homeDir);

        await handle(activity({ text }));

        expect(turns).toEqual([]);
        expect(replies).toHaveLength(1);
      });
    });
  }

  test("a message that starts with ! but names no command reaches the agent", async () => {
    await withTempHome("nakama-teams-commands-", async (homeDir) => {
      const { handle, turns } = createHarness(homeDir);

      await handle(activity({ text: "!urgent summarise the report" }));

      expect(turns.map((turn) => turn.message)).toEqual([
        "!urgent summarise the report",
      ]);
    });
  });

  // Phone keyboards capitalise the first letter of a message.
  test("commands match regardless of letter case", async () => {
    await withTempHome("nakama-teams-commands-", async (homeDir) => {
      const { createdSessions, handle, turns } = createHarness(homeDir);

      await handle(activity({ text: "first" }));
      await handle(activity({ text: "!New" }));

      expect(turns).toHaveLength(1);
      expect(createdSessions).toEqual(["session_1", "session_2"]);
    });
  });

  for (const command of ["!new", "!clear"]) {
    test(`access removed while ${command} waits for the lock stops it there`, async () => {
      await withTempHome("nakama-teams-commands-", async (homeDir) => {
        let configReads = 0;

        const { clearedSessions, createdSessions, handle, replies } =
          createHarness(homeDir, {
            loadConfig: async () => {
              configReads += 1;

              // Only the read inside the lock, on the first command, denies.
              return configReads === 2
                ? { ...CONFIG, allowedUserIds: [] }
                : CONFIG;
            },
          });

        await handle(activity({ text: command }));

        expect(replies).toEqual([]);
        expect(createdSessions).toEqual([]);
        expect(clearedSessions).toEqual([]);

        // The same command with access intact does act, so the check above
        // is what stopped it.
        await handle(activity({ text: command }));

        expect(replies).toHaveLength(1);
        expect(createdSessions).toHaveLength(1);
      });
    });
  }

  for (const command of ["!help", "!stop", "!status", "!new"]) {
    test(`${command} from a user outside the allowlist gets no answer`, async () => {
      await withTempHome("nakama-teams-commands-", async (homeDir) => {
        const { createdSessions, handle, replies } = createHarness(homeDir);

        await handle(
          activity({
            senderId: "99999999-9999-4999-8999-999999999999",
            text: command,
          })
        );

        expect(replies).toEqual([]);
        expect(createdSessions).toEqual([]);
      });
    });
  }
});
