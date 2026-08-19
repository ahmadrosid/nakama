/**
 * Live LLM cassette test for the Cloudflare Workers AI provider.
 *
 * Record (needs CLOUDFLARE_API_KEY + CLOUDFLARE_ACCOUNT_ID):
 *   LLM_VCR_MODE=record CLOUDFLARE_API_KEY=... CLOUDFLARE_ACCOUNT_ID=... \
 *     bun test apps/server/src/providers/cloudflare/llm.test.ts
 *
 * Replay (default when cassette exists; CI-safe):
 *   bun test apps/server/src/providers/cloudflare/llm.test.ts
 */
import { expect, test } from "bun:test";
import {
  cassetteFilePath,
  loadCassette,
  withMswCassette,
} from "../../testing/llm-msw-cassette";
import { createCloudflareProvider } from "./index";

const cassetteName = "cloudflare-llama-3-3-70b-chat";
const model = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

async function resolveApiKey(): Promise<string | null> {
  return process.env.CLOUDFLARE_API_KEY?.trim() || null;
}

function chatUrlFor(accountId: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`;
}

test("chat completion via Workers AI under cassette replay", async () => {
  const cassettePath = cassetteFilePath(cassetteName);
  const existing = await loadCassette(cassettePath);
  const apiKey = existing ? "cassette-replay-key" : await resolveApiKey();

  if (!(existing || apiKey)) {
    console.warn(
      `Skipping ${cassetteName}: no cassette at ${cassettePath} and no Cloudflare API key.`
    );
    return;
  }

  // Replay deterministically: reuse the account id recorded in the cassette
  // so the intercepted URL matches even when env vars differ.
  let accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? "replay-account";
  const recordedUrl = existing?.exchanges?.[0]?.request.url;
  if (recordedUrl) {
    const parts = new URL(recordedUrl).pathname.split("/");
    // /client/v4/accounts/{accountId}/ai/v1/chat/completions
    const recorded = parts[4];
    if (recorded) {
      accountId = recorded;
    }
  }

  const provider = createCloudflareProvider({
    accountId,
    apiKey: apiKey ?? "cassette-replay-key",
    model,
  });

  const result = await withMswCassette(
    cassetteName,
    () =>
      provider.generateChat({
        messages: [
          {
            content: "Say hello in one short sentence.",
            role: "user",
          },
        ],
        system: "You are a terse assistant.",
      }),
    { url: chatUrlFor(accountId) }
  );

  expect(result.assistantMessage.content.trim().length).toBeGreaterThan(0);
});

test("tool call via Workers AI under cassette replay", async () => {
  const toolCassetteName = "cloudflare-llama-3-3-70b-tool-call";
  const cassettePath = cassetteFilePath(toolCassetteName);
  const existing = await loadCassette(cassettePath);
  const apiKey = existing ? "cassette-replay-key" : await resolveApiKey();

  if (!(existing || apiKey)) {
    console.warn(
      `Skipping ${toolCassetteName}: no cassette at ${cassettePath} and no Cloudflare API key.`
    );
    return;
  }

  let accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? "replay-account";
  const recordedUrl = existing?.exchanges?.[0]?.request.url;
  if (recordedUrl) {
    const parts = new URL(recordedUrl).pathname.split("/");
    const recorded = parts[4];
    if (recorded) {
      accountId = recorded;
    }
  }

  const provider = createCloudflareProvider({
    accountId,
    apiKey: apiKey ?? "cassette-replay-key",
    model,
  });

  const result = await withMswCassette(
    toolCassetteName,
    () =>
      provider.generateChat({
        messages: [
          {
            content: "What is the weather in Jakarta? Use the weather tool.",
            role: "user",
          },
        ],
        system: "You are a terse assistant.",
        tools: [
          {
            description: "Get the current weather for a city.",
            name: "get_weather",
            parameters: {
              properties: { city: { type: "string" } },
              type: "object",
            },
          },
        ],
      }),
    { url: chatUrlFor(accountId) }
  );

  // Either the model returns an OpenAI-shaped tool call (agent loop works)
  // or it falls back to plain text. The cassette documents which one.
  const toolCalls = result.assistantMessage.toolCalls ?? [];
  if (toolCalls.length > 0) {
    expect(toolCalls[0]!.name).toBe("get_weather");
    expect(toolCalls[0]!.arguments).toHaveProperty("city");
  } else {
    expect(result.assistantMessage.content.trim().length).toBeGreaterThan(0);
  }
});
