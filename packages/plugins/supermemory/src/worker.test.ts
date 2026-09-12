import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installServer, providerEnvironment } from "./worker";

test("worker maps API-key and local providers without forwarding subscription credentials", () => {
  expect(
    providerEnvironment({
      apiKey: "test-key",
      model: "test-model",
      type: "openai",
    })
  ).toEqual({
    OPENAI_API_KEY: "test-key",
    OPENAI_BASE_URL: "https://api.openai.com/v1",
    OPENAI_MODEL: "test-model",
  });
  expect(providerEnvironment({ model: "local", type: "ollama" })).toMatchObject(
    {
      OPENAI_API_KEY: "ollama",
      OPENAI_BASE_URL: "http://localhost:11434/v1",
    }
  );
  expect(
    providerEnvironment({ apiKey: "test-key", type: "anthropic" })
  ).toEqual({ ANTHROPIC_API_KEY: "test-key" });
  expect(() =>
    providerEnvironment({
      apiKey: "subscription-secret",
      baseUrl: "https://example.com",
      type: "chatgpt",
    })
  ).toThrow();
  expect(() => providerEnvironment({ type: "openai" })).toThrow();
  expect(
    providerEnvironment({ baseUrl: "http://localhost:11434/", type: "ollama" })
      .OPENAI_BASE_URL
  ).toBe("http://localhost:11434/v1");
});

test("the worker rejects a binary whose checksum does not match the pinned release", async () => {
  const directory = await mkdtemp(join(tmpdir(), "supermemory-download-"));
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response("not-a-server")) as unknown as typeof fetch;
  try {
    await expect(installServer(directory)).rejects.toThrow("checksum mismatch");
    expect(
      await Bun.file(join(directory, "supermemory-server-0.0.8")).exists()
    ).toBe(false);
  } finally {
    globalThis.fetch = original;
    await rm(directory, { force: true, recursive: true });
  }
});
