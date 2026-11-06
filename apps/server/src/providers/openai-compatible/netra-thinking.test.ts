import { afterEach, expect, mock, test } from "bun:test";
import { parseJsonRecord } from "../shared";
import { asTestFetch } from "../test-helpers";
import { createOpenAICompatibleProvider } from "./index";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("Netra passes max through and lowers xhigh to high", async () => {
  const efforts: unknown[] = [];
  globalThis.fetch = asTestFetch(
    mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      efforts.push(parseJsonRecord(String(init?.body)).reasoning);

      return Response.json({ choices: [{ message: { content: "Hi" } }] });
    })
  );

  const provider = createOpenAICompatibleProvider({
    apiKey: "test-key",
    baseUrl: "https://api.netraruntime.com/v1",
    displayName: "Netra Runtime",
    model: "deepseek/deepseek-v4.1-flash",
    providerName: "netra",
    supportsThinking: true,
  });

  for (const effort of ["max", "xhigh", "medium", "low"] as const) {
    await provider.generateChat({
      messages: [{ content: "Hi", role: "user" }],
      providerOptions: { thinking: { effort, enabled: true } },
      system: "Help",
    });
  }

  expect(efforts).toEqual([
    { effort: "max" },
    { effort: "high" },
    { effort: "high" },
    { effort: "low" },
  ]);
});
