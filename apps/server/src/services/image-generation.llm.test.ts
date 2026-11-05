/**
 * Live LLM cassette test for OpenAI Images generations (gpt-image-2).
 *
 * Record (needs OPENAI_API_KEY or configured OpenAI provider):
 *   LLM_VCR_MODE=record bun test src/services/image-generation.llm.test.ts
 *
 * Replay (default when cassette exists; CI-safe):
 *   bun test src/services/image-generation.llm.test.ts
 *
 * If the cassette is missing and no API key is available, the test is skipped.
 */
import { expect, test } from "bun:test";
import {
  applyChatgptOAuthToInstance,
  type ChatgptOAuthCredentials,
  loadUserConfig,
  readChatgptOAuthFromInstance,
  saveUserConfig,
} from "@nakama/core";
import { z } from "zod";
import { readApiKeyForInstance } from "../providers/create";
import {
  cassetteFilePath,
  loadCassette,
  withMswCassette,
} from "../testing/llm-msw-cassette";
import { generateImageWithOpenAI } from "./image-generation";

const cassetteName = "image-generation-gpt-image-2";

const imagesUrl = "https://api.openai.com/v1/images/generations";

async function resolveOpenAiApiKey(): Promise<string | null> {
  const config = await loadUserConfig();

  const configured =
    config?.providers.find((provider) => provider.type === "openai") ?? null;

  if (configured) {
    const key = readApiKeyForInstance(configured, process.env)?.trim();

    if (key) {
      return key;
    }
  }

  const envKey = process.env.OPENAI_API_KEY?.trim();

  return envKey || null;
}

test("generates a non-empty png via Images API under cassette replay", async () => {
  const cassettePath = cassetteFilePath(cassetteName);
  const existing = await loadCassette(cassettePath);
  const apiKey = existing ? "cassette-replay-key" : await resolveOpenAiApiKey();

  if (!(existing || apiKey)) {
    // Offline-safe: commit a cassette for replay; skip only when neither cassette nor key exists.
    console.warn(
      `Skipping ${cassetteName}: no cassette at ${cassettePath} and no OpenAI API key.`
    );

    return;
  }

  const result = await withMswCassette(
    cassetteName,
    async () =>
      generateImageWithOpenAI({
        apiKey: apiKey!,
        model: "gpt-image-2",
        prompt: "A tiny red circle on white background, minimal",
        size: "1024x1024",
      }),
    { url: imagesUrl }
  );

  expect(result.model).toBe("gpt-image-2");
  expect(result.mediaType).toMatch(/^image\//);
  expect(result.data.byteLength).toBeGreaterThan(0);
  expect(result.size).toBe("1024x1024");

  // PNG magic bytes when output is png
  if (result.mediaType === "image/png") {
    expect(result.data[0]).toBe(0x89);
    expect(result.data[1]).toBe(0x50);
  }
});

const chatgptCassetteName = "image-generation-chatgpt";

/** 1x1 transparent PNG: keeps the cassette small. */
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** Swaps the image for a tiny PNG and drops the ChatGPT user id. */
function shrinkChatgptImageStream<T>(body: T): T | string {
  const text = z.string().safeParse(body);

  if (!text.success) {
    return body;
  }

  return text.data
    .replaceAll(/"result":"[^"]*"/g, `"result":"${TINY_PNG_BASE64}"`)
    .replaceAll(
      /"safety_identifier":"[^"]*"/g,
      '"safety_identifier":"redacted"'
    );
}

test("generates a png through the ChatGPT image tool under cassette replay", async () => {
  const cassettePath = cassetteFilePath(chatgptCassetteName);
  const existing = await loadCassette(cassettePath);
  const config = existing ? null : await loadUserConfig();

  const instance =
    config?.providers.find((provider) => provider.type === "chatgpt") ?? null;

  const oauth = existing
    ? {
        accessToken: "cassette-replay-token",
        accountId: "cassette-account",
        expiresAt: "2099-01-01T00:00:00.000Z",
        refreshToken: "cassette-refresh",
      }
    : instance && readChatgptOAuthFromInstance(instance);

  if (!oauth) {
    console.warn(
      `Skipping ${chatgptCassetteName}: no cassette at ${cassettePath} and no connected ChatGPT provider.`
    );

    return;
  }

  // Recording uses the real sign-in. A refresh token works once, so a
  // rotated one must be saved or the local ChatGPT provider stops working.
  const saveRecordedOAuth = async (next: ChatgptOAuthCredentials) => {
    if (config && instance) {
      await saveUserConfig({
        ...config,
        providers: config.providers.map((provider) =>
          provider.id === instance.id
            ? applyChatgptOAuthToInstance(provider, next)
            : provider
        ),
      });
    }
  };

  const result = await withMswCassette(
    chatgptCassetteName,
    () =>
      generateImageWithOpenAI({
        apiKey: oauth.accessToken,
        chatgpt: { oauth, onTokenRefresh: saveRecordedOAuth },
        model: "gpt-6-sol",
        prompt: "A tiny red circle on white background, minimal",
        size: "1024x1024",
      }),
    {
      redactResponse: shrinkChatgptImageStream,
      url: "https://chatgpt.com/backend-api/codex/responses",
    }
  );

  expect(result.model).toBe("gpt-6-sol");
  expect(result.mediaType).toBe("image/png");
  expect(result.data[0]).toBe(0x89);
  expect(result.data[1]).toBe(0x50);
  expect(result.usage?.outputTokens).toBeGreaterThan(0);
  // Recording waits on a real generation (25-80s).
}, 180_000);
