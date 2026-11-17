import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { asTestFetch } from "../test-helpers";
import { fetchOllamaModels } from "./models";

describe("fetchOllamaModels", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    expect(globalThis.fetch).toBe(originalFetch);
  });

  test("uses /v1/models when available", async () => {
    using _fetchMock = spyOn(globalThis, "fetch").mockImplementation(
      asTestFetch(async (input) => {
        const url = String(input);

        if (url.endsWith("/models")) {
          return new Response(JSON.stringify({ data: [{ id: "llama3" }] }), {
            status: 200,
          });
        }

        throw new Error(`unexpected fetch: ${url}`);
      })
    );

    const models = await fetchOllamaModels("http://localhost:11434/v1");

    expect(models).toEqual([{ id: "llama3", name: "llama3" }]);
  });

  test("falls back to /api/tags when /v1/models fails", async () => {
    using _fetchMock = spyOn(globalThis, "fetch").mockImplementation(
      asTestFetch(async (input) => {
        const url = String(input);

        if (url.endsWith("/models")) {
          return new Response("fail", { status: 500 });
        }

        if (url.endsWith("/api/tags")) {
          return new Response(
            JSON.stringify({
              models: [{ name: "gemma3:latest" }, { model: "llama3" }],
            }),
            { status: 200 }
          );
        }

        throw new Error(`unexpected fetch: ${url}`);
      })
    );

    const models = await fetchOllamaModels("http://localhost:11434/v1");

    expect(models).toEqual([
      { id: "gemma3:latest", name: "gemma3:latest" },
      { id: "llama3", name: "llama3" },
    ]);
  });

  test("sends Authorization header to /api/tags when apiKey is set", async () => {
    const seen: string[] = [];

    using _fetchMock = spyOn(globalThis, "fetch").mockImplementation(
      asTestFetch(async (input, init) => {
        const url = String(input);

        if (url.endsWith("/models")) {
          return new Response("fail", { status: 500 });
        }

        if (url.endsWith("/api/tags")) {
          seen.push(new Headers(init?.headers).get("Authorization") ?? "");

          return new Response(
            JSON.stringify({ models: [{ name: "gpt-oss:120b" }] }),
            {
              status: 200,
            }
          );
        }

        throw new Error(`unexpected fetch: ${url}`);
      })
    );

    await fetchOllamaModels("https://ollama.com/v1", "secret-key");

    expect(seen).toEqual(["Bearer secret-key"]);
  });

  test("reports an unreachable Ollama host as a 502, not a server crash", async () => {
    using _fetchMock = spyOn(globalThis, "fetch").mockImplementation(
      asTestFetch(async () => {
        throw new TypeError("Unable to connect.");
      })
    );

    await expect(
      fetchOllamaModels("http://localhost:11434/v1")
    ).rejects.toMatchObject({ status: 502 });
  });

  test.each([
    { compatible: false, prefix: "", suffix: "" },
    { compatible: false, prefix: "", suffix: "/" },
    { compatible: false, prefix: "/ollama", suffix: "" },
    { compatible: false, prefix: "/ollama", suffix: "/" },
    { compatible: true, prefix: "/ollama", suffix: "" },
    { compatible: false, prefix: "/proxy/v1/ollama", suffix: "" },
    { compatible: false, prefix: "/ollama", suffix: "", version: "" },
  ])(
    "discovers models through a local endpoint: %j",
    async ({ prefix, suffix, compatible, version = "/v1" }) => {
      const paths: string[] = [];
      const nativeAuthorization: Array<string | null> = [];

      const server = Bun.serve({
        fetch(request) {
          const path = new URL(request.url).pathname;
          paths.push(path);

          if (compatible && path === `${prefix}/v1/models`) {
            return Response.json({ data: [{ id: "local-model" }] });
          }

          if (path === `${prefix}/api/tags`) {
            nativeAuthorization.push(request.headers.get("Authorization"));

            return Response.json({ models: [{ name: "local-model" }] });
          }

          return new Response("Not found", { status: 404 });
        },
        hostname: "127.0.0.1",
        port: 0,
      });

      try {
        const models = await fetchOllamaModels(
          `${server.url.origin}${prefix}${version}${suffix}`
        );

        expect(models).toEqual([{ id: "local-model", name: "local-model" }]);
        expect(paths).toContain(
          compatible ? `${prefix}/v1/models` : `${prefix}/api/tags`
        );

        if (!compatible) {
          expect(nativeAuthorization).toEqual([null]);
        }
      } finally {
        server.stop(true);
      }
    }
  );

  test.each(["", "/ollama"])(
    "keeps Authorization on the native fallback behind prefix %s",
    async (prefix) => {
      const authorization: Array<string | null> = [];

      const server = Bun.serve({
        fetch(request) {
          if (new URL(request.url).pathname !== `${prefix}/api/tags`) {
            return new Response("Not found", { status: 404 });
          }

          authorization.push(request.headers.get("Authorization"));

          return request.headers.get("Authorization") === "Bearer fixture-key"
            ? Response.json({ models: [{ name: "local-model" }] })
            : new Response("Unauthorized", { status: 401 });
        },
        hostname: "127.0.0.1",
        port: 0,
      });

      try {
        const models = await fetchOllamaModels(
          `${server.url.origin}${prefix}/v1`,
          "  fixture-key  "
        );

        expect(models).toEqual([{ id: "local-model", name: "local-model" }]);
        expect(authorization).toEqual(["Bearer fixture-key"]);
      } finally {
        server.stop(true);
      }
    }
  );
});
