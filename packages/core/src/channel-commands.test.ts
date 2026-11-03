import { describe, expect, test } from "bun:test";
import { formatClientError } from "./api-error";
import {
  type ChannelCommand,
  type ChannelCommandHandlers,
  channelCommandHelp,
  describeChannelStatus,
  parseChannelCommand,
  runChannelCommand,
} from "./channel-commands";
import type { ProviderName } from "./contract";

describe("parseChannelCommand", () => {
  test("reads the first word after the prefix, in any letter case", () => {
    expect(parseChannelCommand("!help", "!")).toBe("help");
    expect(parseChannelCommand("!New please", "!")).toBe("new");
    expect(parseChannelCommand("!STOP", "!")).toBe("stop");
    expect(parseChannelCommand("!clear\nnow", "!")).toBe("clear");
    expect(parseChannelCommand("/status", "/")).toBe("status");
  });

  test("anything else is a message for the agent", () => {
    expect(parseChannelCommand("!urgent summarise the report", "!")).toBeNull();
    expect(parseChannelCommand("help", "!")).toBeNull();
    expect(parseChannelCommand("!", "!")).toBeNull();
    expect(parseChannelCommand("/new", "!")).toBeNull();
    expect(parseChannelCommand("please !stop", "!")).toBeNull();
  });
});

test("channelCommandHelp lists the five commands with the channel's prefix", () => {
  expect(channelCommandHelp("!")).toBe(
    [
      "!new: start a fresh conversation",
      "!clear: clear this conversation's history",
      "!stop: stop the current reply",
      "!status: server and model status",
      "!help: this message",
    ].join("\n")
  );
});

function createHandlers(overrides: Partial<ChannelCommandHandlers> = {}) {
  const events: string[] = [];

  const handlers: ChannelCommandHandlers = {
    clearSession: async () => {
      events.push("clearSession");
    },
    helpText: "the help",
    reply: async (text) => {
      events.push(`reply:${text}`);
    },
    runLocked: async (work) => {
      events.push("lock");
      await work();
      events.push("unlock");
    },
    startSession: async () => {
      events.push("startSession");
    },
    status: async () => "the status",
    stop: () => {
      events.push("stop");

      return true;
    },
    stopRunning: () => {
      events.push("stopRunning");
    },
    ...overrides,
  };

  return { events, handlers };
}

describe("runChannelCommand", () => {
  test("stop says whether there was anything to stop", async () => {
    const stopped = createHandlers();
    await runChannelCommand("stop", stopped.handlers);
    expect(stopped.events).toEqual(["stop", "reply:Stopping…"]);

    const idle = createHandlers({ stop: () => false });
    await runChannelCommand("stop", idle.handlers);
    expect(idle.events).toEqual(["reply:Nothing to stop."]);
  });

  test("help and status answer without the lock", async () => {
    const { events, handlers } = createHandlers();

    await runChannelCommand("help", handlers);
    await runChannelCommand("status", handlers);

    expect(events).toEqual(["reply:the help", "reply:the status"]);
  });

  // The running turn holds the lock until it ends, so it is stopped first.
  test("new and clear stop the running turn, then work inside the lock", async () => {
    const started = createHandlers();
    await runChannelCommand("new", started.handlers);
    expect(started.events).toEqual([
      "stopRunning",
      "lock",
      "startSession",
      "reply:Started a new conversation.",
      "unlock",
    ]);

    const cleared = createHandlers();
    await runChannelCommand("clear", cleared.handlers);
    expect(cleared.events).toEqual([
      "stopRunning",
      "lock",
      "clearSession",
      "reply:History cleared.",
      "unlock",
    ]);
  });

  test("a failure inside the lock reaches the channel", async () => {
    const failure = new Error("server down");

    const { events, handlers } = createHandlers({
      startSession: () => Promise.reject(failure),
    });

    await expect(runChannelCommand("new", handlers)).rejects.toBe(failure);
    expect(events).toEqual(["stopRunning", "lock"]);
  });

  test("covers every command", async () => {
    const commands: ChannelCommand[] = [
      "clear",
      "help",
      "new",
      "status",
      "stop",
    ];

    for (const command of commands) {
      const { events, handlers } = createHandlers();
      await runChannelCommand(command, handlers);
      expect(events.some((event) => event.startsWith("reply:"))).toBe(true);
    }
  });
});

function createSource(
  options: {
    failHealth?: Error;
    provider?: ProviderName | null;
    providerConfigured?: boolean;
  } = {}
) {
  const calls: string[] = [];

  return {
    calls,
    source: {
      getModels: async () => {
        calls.push("getModels");

        return { provider: options.provider ?? null };
      },
      health: async () => {
        calls.push("health");

        if (options.failHealth) {
          throw options.failHealth;
        }

        return {
          ok: true as const,
          providerConfigured: options.providerConfigured ?? true,
        };
      },
    },
  };
}

describe("describeChannelStatus", () => {
  test("names the agent, provider, model and session", async () => {
    const { source } = createSource({ provider: "openai" });

    const status = await describeChannelStatus(source, {
      findAgent: async () => ({
        agent: { model: "openai::gpt-5", name: "Research" },
        id: "profile_1",
      }),
      label: "Agent",
      sessionId: "abcdefgh-1234-5678",
    });

    expect(status).toBe(
      [
        "Server: ok",
        "Provider configured: yes",
        "Agent: Research",
        "Provider: openai",
        "Model: gpt-5",
        "Session: abcdefgh",
      ].join("\n")
    );
  });

  test("uses the channel's label and leaves out a session it does not have", async () => {
    const { source } = createSource({ provider: "anthropic" });

    const status = await describeChannelStatus(source, {
      findAgent: async () => ({
        agent: { model: "claude", name: "Helper" },
        id: "profile_1",
      }),
      label: "Profile",
    });

    expect(status).toBe(
      [
        "Server: ok",
        "Provider configured: yes",
        "Profile: Helper",
        "Provider: anthropic",
        "Model: claude",
      ].join("\n")
    );
  });

  test("falls back to the agent id, an unknown provider and no model", async () => {
    const { source } = createSource();

    const status = await describeChannelStatus(source, {
      findAgent: async () => ({ agent: undefined, id: "profile_9" }),
      label: "Agent",
    });

    expect(status).toBe(
      [
        "Server: ok",
        "Provider configured: yes",
        "Agent: profile_9",
        "Provider: unknown",
        "Model: none",
      ].join("\n")
    );
  });

  test("keeps everything after the first provider separator in the model", async () => {
    const { source } = createSource({ provider: "openrouter" });

    const status = await describeChannelStatus(source, {
      findAgent: async () => ({
        agent: { model: "openrouter::meta::llama", name: "A" },
        id: "p",
      }),
      label: "Agent",
    });

    expect(status).toContain("Model: meta::llama");
  });

  test("without a provider it says so and looks up no agent", async () => {
    const { calls, source } = createSource({ providerConfigured: false });
    let looked = false;

    const status = await describeChannelStatus(source, {
      findAgent: async () => {
        looked = true;

        return { agent: undefined, id: "p" };
      },
      label: "Agent",
      sessionId: "12345678abc",
    });

    expect(status).toBe(
      [
        "Server: ok",
        "Provider configured: no",
        "Chat runs in offline mode without an API key.",
        "Session: 12345678",
      ].join("\n")
    );
    expect(calls).toEqual(["health"]);
    expect(looked).toBe(false);
  });

  test("a failed lookup becomes the error message", async () => {
    const failure = new Error("connection refused");
    const { source } = createSource({ failHealth: failure });

    const status = await describeChannelStatus(source, {
      findAgent: async () => ({ agent: undefined, id: "p" }),
      label: "Agent",
    });

    expect(status).toBe(formatClientError(failure));
  });

  test("an agent lookup that throws becomes the error message", async () => {
    const failure = new Error("The connection owner is unavailable.");
    const { source } = createSource({ provider: "openai" });

    const status = await describeChannelStatus(source, {
      findAgent: () => Promise.reject(failure),
      label: "Agent",
    });

    expect(status).toBe(formatClientError(failure));
  });
});
