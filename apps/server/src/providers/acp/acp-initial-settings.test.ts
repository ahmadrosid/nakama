import { afterEach, describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { createAcpProvider, stopAcpSession } from "./acp-provider";

const FAKE_AGENT = fileURLToPath(
  new URL("../../testing/acp-fake-agent.ts", import.meta.url)
);

const keys: string[] = [];

function newKey(): string {
  const key = `initial-settings-${crypto.randomUUID()}`;
  keys.push(key);

  return key;
}

afterEach(() => {
  for (const key of keys.splice(0)) {
    stopAcpSession(key);
  }
});

describe("ACP initial settings", () => {
  test("a new session starts with the profile's saved model", async () => {
    const provider = createAcpProvider({
      agent: { args: [FAKE_AGENT], command: "bun" },
      cwd: process.cwd(),
      initialSettings: { model: "fake-smart" },
      sessionKey: newKey(),
    });

    const result = await provider.generateChat({
      messages: [{ content: "hello", role: "user" }],
      system: "",
    });

    expect(result.content).toBe("[smart] fake: hello");
  });

  test("a saved value the agent no longer offers is skipped", async () => {
    const provider = createAcpProvider({
      agent: { args: [FAKE_AGENT], command: "bun" },
      cwd: process.cwd(),
      initialSettings: { model: "retired-model" },
      sessionKey: newKey(),
    });

    const result = await provider.generateChat({
      messages: [{ content: "hello", role: "user" }],
      system: "",
    });

    expect(result.content).toBe("fake: hello");
  });
});
