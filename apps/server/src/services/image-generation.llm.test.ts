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
import { loadUserConfig } from "@nakama/core";
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
