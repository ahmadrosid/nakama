import { afterEach, describe, expect, jest, test } from "bun:test";
import { fileURLToPath } from "node:url";
import {
  type AcpProviderOptions,
  adoptAcpDraftSession,
  createAcpProvider,
  getAcpConfigOptions,
  setAcpConfigOption,
  stopAcpSession,
} from "./acp-provider";

const FAKE_AGENT = fileURLToPath(
  new URL("../../testing/acp-fake-agent.ts", import.meta.url)
);

const keys = new Set<string>();

function optionsFor(sessionKey: string): AcpProviderOptions {
  keys.add(sessionKey);

  return {
    agent: { args: [FAKE_AGENT], command: "bun" },
    cwd: process.cwd(),
    sessionKey,
  };
}

afterEach(() => {
  for (const key of keys) {
    stopAcpSession(key);
  }

  keys.clear();
});

describe("ACP draft settings", () => {
  test("a model picked on a draft applies to the chat it becomes", async () => {
    const draft = `draft-${crypto.randomUUID()}`;
    const chat = `chat-${crypto.randomUUID()}`;

    await setAcpConfigOption(optionsFor(draft), "model", "fake-smart");
    expect(adoptAcpDraftSession(draft, chat)).toBe(true);

    const provider = createAcpProvider(optionsFor(chat));

    const result = await provider.generateChat({
      messages: [{ content: "hi", role: "user" }],
      system: "",
    });

    const settings = await getAcpConfigOptions(optionsFor(chat));

    expect(result.content).toBe("[smart] fake: hi");
    const model = settings[0];
    expect(model?.type === "select" && model.currentValue).toBe("fake-smart");
  });

  test("adoption does nothing when the chat already has an agent", async () => {
    const draft = `draft-${crypto.randomUUID()}`;
    const chat = `chat-${crypto.randomUUID()}`;

    await getAcpConfigOptions(optionsFor(draft));
    await getAcpConfigOptions(optionsFor(chat));

    expect(adoptAcpDraftSession(draft, chat)).toBe(false);
  });

  test("a draft agent that never gets a message stops when idle", async () => {
    const draft = `draft-${crypto.randomUUID()}`;
    const chat = `chat-${crypto.randomUUID()}`;

    jest.useFakeTimers();

    try {
      await getAcpConfigOptions(optionsFor(draft));
      jest.advanceTimersByTime(10 * 60 * 1000);
    } finally {
      jest.useRealTimers();
    }

    expect(adoptAcpDraftSession(draft, chat)).toBe(false);
  });

  test("the idle stop leaves a running turn alone", async () => {
    const chat = `chat-${crypto.randomUUID()}`;
    const other = `chat-${crypto.randomUUID()}`;

    jest.useFakeTimers();

    try {
      const provider = createAcpProvider(optionsFor(chat));

      // The thought chunk arrives mid-turn, so the timeout passes while the turn runs.
      const result = await provider.streamChat(
        { messages: [{ content: "thought", role: "user" }], system: "" },
        {
          onChunk: () => {},
          onThinking: () => {
            jest.advanceTimersByTime(10 * 60 * 1000);
          },
        }
      );

      expect(result.content).toBe("fake: thought");
    } finally {
      jest.useRealTimers();
    }

    expect(adoptAcpDraftSession(chat, optionsFor(other).sessionKey)).toBe(true);
  });
});
