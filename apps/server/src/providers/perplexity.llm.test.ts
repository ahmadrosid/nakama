/**
 * Live LLM cassette test for the Perplexity Sonar provider.
 *
 * Record (needs PERPLEXITY_API_KEY):
 *   LLM_VCR_MODE=record PERPLEXITY_API_KEY=... \
 *     bun test apps/server/src/providers/perplexity.llm.test.ts
 *
 * Replay (default when cassette exists; CI-safe):
 *   bun test apps/server/src/providers/perplexity.llm.test.ts
 */
import { expect, test } from "bun:test";
import type { ProviderInstance } from "@nakama/core";
import {
  cassetteFilePath,
  loadCassette,
  withMswCassette,
} from "../testing/llm-msw-cassette";
import { createProviderForInstance } from "./create";

const cassetteName = "perplexity-sonar-chat";
const chatUrl = "https://api.perplexity.ai/chat/completions";

test("chat completion keeps Sonar citations under cassette replay", async () => {
  const cassettePath = cassetteFilePath(cassetteName);
  const existing = await loadCassette(cassettePath);
  const apiKey = existing
    ? "cassette-replay-key"
    : process.env.PERPLEXITY_API_KEY?.trim();

  if (!(existing || apiKey)) {
    console.warn(
      `Skipping ${cassetteName}: no cassette at ${cassettePath} and no Perplexity API key.`
    );
    return;
  }

  const instance: ProviderInstance = {
    apiKey: apiKey ?? "cassette-replay-key",
    createdAt: new Date().toISOString(),
    id: "inst_perplexity_cassette",
    label: "Perplexity Sonar",
    type: "perplexity",
  };
  const provider = createProviderForInstance(instance, "sonar");

  expect(provider).not.toBeNull();

  const result = await withMswCassette(
    cassetteName,
    () =>
      provider!.generateChat({
        messages: [
          {
            content:
              "What command installs project dependencies with Bun? Answer in one short sentence.",
            role: "user",
          },
        ],
        system: "Use current web sources and keep the answer concise.",
      }),
    { url: chatUrl }
  );

  expect(result.assistantMessage.content.trim().length).toBeGreaterThan(0);
  expect(result.assistantMessage.content).toMatch(/<https?:\/\/[^>]+>/);
});
