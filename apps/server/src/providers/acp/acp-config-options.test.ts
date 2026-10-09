import { afterEach, describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import {
  type AcpProviderOptions,
  createAcpProvider,
  getAcpConfigOptions,
  setAcpConfigOption,
  stopAcpSession,
} from "./acp-provider";

const FAKE_AGENT = fileURLToPath(
  new URL("../../testing/acp-fake-agent.ts", import.meta.url)
);

const sessionKeys: string[] = [];

function providerOptions(name: string): AcpProviderOptions {
  const sessionKey = `config-test-${name}-${sessionKeys.length}`;
  sessionKeys.push(sessionKey);

  return {
    agent: { args: [FAKE_AGENT], command: "bun" },
    cwd: process.cwd(),
    sessionKey,
  };
}

afterEach(() => {
  for (const sessionKey of sessionKeys.splice(0)) {
    stopAcpSession(sessionKey);
  }
});

describe("ACP agent settings", () => {
  test("lists the model and reasoning effort the agent offers", async () => {
    const options = providerOptions("list");

    const configOptions = await getAcpConfigOptions(options);

    expect(configOptions.map((option) => [option.id, option.category])).toEqual(
      [
        ["model", "model"],
        ["effort", "thought_level"],
      ]
    );
    const model = configOptions[0];
    expect(model?.type === "select" && model.currentValue).toBe("fake-fast");
  });

  test("a chosen model applies to the next reply", async () => {
    const options = providerOptions("set");
    const provider = createAcpProvider(options);

    await setAcpConfigOption(options, "model", "fake-smart");

    const result = await provider.generateChat({
      messages: [{ content: "hello", role: "user" }],
      system: "",
    });

    expect(result.content).toBe("[smart] fake: hello");
  });

  test("reading settings before the first message keeps the system prompt", async () => {
    const options = providerOptions("order");
    const provider = createAcpProvider(options);

    await getAcpConfigOptions(options);

    const result = await provider.generateChat({
      messages: [{ content: "first", role: "user" }],
      system: "Be brief.",
    });

    expect(result.content).toBe("fake: Be brief.\n\nfirst");
  });
});
