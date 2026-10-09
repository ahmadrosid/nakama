import { afterEach, describe, expect, test } from "bun:test";
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
});
