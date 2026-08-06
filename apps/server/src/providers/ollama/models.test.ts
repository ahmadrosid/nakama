import { describe, expect, mock, test } from "bun:test";
import { fetchOllamaModels } from "./models";

describe("fetchOllamaModels", () => {
  test("uses /v1/models when available", async () => {
    const fetchMock = mock(async (input: string | URL) => {
      const url = String(input);

      if (url.endsWith("/models")) {
        return new Response(JSON.stringify({ data: [{ id: "llama3" }] }), { status: 200 });
      }

      throw new Error(`unexpected fetch: ${url}`);
    });

    globalThis.fetch = fetchMock as typeof fetch;

    const models = await fetchOllamaModels("http://localhost:11434/v1");

    expect(models).toEqual([{ id: "llama3", name: "llama3" }]);
  });

  test("falls back to /api/tags when /v1/models fails", async () => {
    const fetchMock = mock(async (input: string | URL) => {
      const url = String(input);

      if (url.endsWith("/models")) {
        return new Response("fail", { status: 500 });
      }

      if (url.endsWith("/api/tags")) {
        return new Response(
          JSON.stringify({
            models: [{ name: "gemma3:latest" }, { model: "llama3" }],
          }),
          { status: 200 },
        );
      }

      throw new Error(`unexpected fetch: ${url}`);
    });

    globalThis.fetch = fetchMock as typeof fetch;

    const models = await fetchOllamaModels("http://localhost:11434/v1");

    expect(models).toEqual([
      { id: "gemma3:latest", name: "gemma3:latest" },
      { id: "llama3", name: "llama3" },
    ]);
  });

  test("sends Authorization header to /api/tags when apiKey is set", async () => {
    const seen: string[] = [];
    const fetchMock = mock(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/models")) {
        return new Response("fail", { status: 500 });
      }

      if (url.endsWith("/api/tags")) {
        seen.push(String((init?.headers as Record<string, string>)?.Authorization ?? ""));
        return new Response(JSON.stringify({ models: [{ name: "gpt-oss:120b" }] }), {
          status: 200,
        });
      }

      throw new Error(`unexpected fetch: ${url}`);
    });

    globalThis.fetch = fetchMock as typeof fetch;

    await fetchOllamaModels("https://ollama.com/v1", "secret-key");

    expect(seen).toEqual(["Bearer secret-key"]);
  });
});
