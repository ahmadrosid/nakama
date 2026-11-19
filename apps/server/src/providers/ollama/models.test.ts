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
    { prefix: "/ollama", suffix: "" },
    { prefix: "/ollama", suffix: "/" },
    { prefix: "/proxy/v1/ollama", suffix: "" },
  ])(
    "discovers models through a prefixed endpoint: %j",
    async ({ prefix, suffix }) => {
      const paths: string[] = [];
      const nativeAuthorization: Array<string | null> = [];

      const server = Bun.serve({
        fetch(request) {
          const path = new URL(request.url).pathname;
          paths.push(path);

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
          `${server.url.origin}${prefix}/v1${suffix}`
        );

        expect(models).toEqual([{ id: "local-model", name: "local-model" }]);
        expect(paths).toContain(`${prefix}/api/tags`);
        expect(nativeAuthorization).toEqual([null]);
      } finally {
        server.stop(true);
      }
    }
  );

  test("uses the root /api/tags when the path does not end in /v1", async () => {
    const seen: string[] = [];

    using _fetchMock = spyOn(globalThis, "fetch").mockImplementation(
      asTestFetch(async (input) => {
        const url = String(input);

        if (url.endsWith("/api/tags")) {
          seen.push(url);

          return new Response(JSON.stringify({ models: [{ name: "llama3" }] }));
        }

        return new Response("Not found", { status: 404 });
      })
    );

    await fetchOllamaModels("http://localhost:11434/api");

    expect(seen).toEqual(["http://localhost:11434/api/tags"]);
  });

  test("rejects a base URL without http(s) as a 400", async () => {
    using _fetchMock = spyOn(globalThis, "fetch").mockImplementation(
      asTestFetch(async () => {
        throw new TypeError("Unable to connect.");
      })
    );

    await expect(fetchOllamaModels("localhost:11434/v1")).rejects.toMatchObject(
      { status: 400 }
    );
  });

  test("keeps Authorization on the native fallback behind a prefix", async () => {
    const prefix = "/ollama";

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
  });
});
