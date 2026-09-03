import { afterEach, describe, expect, test } from "bun:test";
import type { WebSearchConfigFile } from "../web-search-config";
import {
  createCustomWebSearchTool,
  parseCustomWebSearchResults,
} from "./custom-web-search";

const originalFetch = globalThis.fetch;

interface CapturedRequest {
  body: unknown;
  headers: Record<string, string>;
  url: string;
}

function stubFetch(
  response: { body: unknown; status?: number },
  captured: CapturedRequest[]
): void {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    captured.push({
      body: JSON.parse(String(init?.body ?? "{}")),
      headers: (init?.headers ?? {}) as Record<string, string>,
      url: String(input),
    });

    return Promise.resolve(
      new Response(
        typeof response.body === "string"
          ? response.body
          : JSON.stringify(response.body),
        { status: response.status ?? 200 }
      )
    );
  }) as typeof fetch;
}

function config(patch: Partial<WebSearchConfigFile>): WebSearchConfigFile {
  return {
    apiKey: "test-key",
    endpoint: "https://api.exa.ai/search",
    maxResults: 5,
    provider: "exa",
    ...patch,
  };
}

describe("createCustomWebSearchTool", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns null when no search back-end is configured", () => {
    expect(createCustomWebSearchTool(null)).toBeNull();
    expect(createCustomWebSearchTool(config({ apiKey: "" }))).toBeNull();
  });

  test("runs locally instead of on the LLM provider", () => {
    const tool = createCustomWebSearchTool(config({}));

    expect(tool?.name).toBe("web_search");
    expect(tool?.hosted).toBe(false);
  });

  test("sends the Exa request shape and reads results", async () => {
    const captured: CapturedRequest[] = [];
    stubFetch(
      {
        body: {
          results: [
            { text: "Release notes", title: "Bun 1.4", url: "https://bun.sh" },
          ],
        },
      },
      captured
    );

    const tool = createCustomWebSearchTool(config({ maxResults: 3 }));
    const output = await tool?.run({ query: "bun release" }, {});

    expect(captured[0]?.url).toBe("https://api.exa.ai/search");
    expect(captured[0]?.headers["x-api-key"]).toBe("test-key");
    expect(captured[0]?.body).toMatchObject({
      numResults: 3,
      query: "bun release",
    });
    expect(output).toEqual({
      provider: "exa",
      query: "bun release",
      results: [
        { snippet: "Release notes", title: "Bun 1.4", url: "https://bun.sh" },
      ],
    });
  });

  test("sends a bearer token and reads Firecrawl's data.web list", async () => {
    const captured: CapturedRequest[] = [];
    stubFetch(
      {
        body: {
          data: {
            web: [
              {
                description: "Docs",
                title: "Firecrawl",
                url: "https://docs.firecrawl.dev",
              },
            ],
          },
          success: true,
        },
      },
      captured
    );

    const tool = createCustomWebSearchTool(
      config({
        apiKey: "fc-key",
        endpoint: "https://api.firecrawl.dev/v2/search",
        provider: "firecrawl",
      })
    );
    const output = await tool?.run({ query: "scraping" }, {});

    expect(captured[0]?.headers.authorization).toBe("Bearer fc-key");
    expect(captured[0]?.body).toEqual({ limit: 5, query: "scraping" });
    expect(output?.results).toEqual([
      {
        snippet: "Docs",
        title: "Firecrawl",
        url: "https://docs.firecrawl.dev",
      },
    ]);
  });

  test("omits the auth header for a keyless custom endpoint", async () => {
    const captured: CapturedRequest[] = [];
    stubFetch(
      { body: { organic: [{ link: "https://example.com" }] } },
      captured
    );

    const tool = createCustomWebSearchTool(
      config({
        apiKey: "",
        endpoint: "https://search.internal/api",
        provider: "custom",
      })
    );
    const output = await tool?.run({ query: "internal" }, {});

    expect(captured[0]?.headers.authorization).toBeUndefined();
    expect(output?.results).toEqual([
      { title: "https://example.com", url: "https://example.com" },
    ]);
  });

  test("surfaces the endpoint status on failure", async () => {
    stubFetch({ body: "quota exceeded", status: 402 }, []);

    const tool = createCustomWebSearchTool(config({}));

    await expect(tool?.run({ query: "anything" }, {})).rejects.toThrow(
      "Exa returned 402"
    );
  });
});

describe("parseCustomWebSearchResults", () => {
  test("drops entries without a URL, dedupes and caps at maxResults", () => {
    const results = parseCustomWebSearchResults(
      {
        results: [
          { title: "One", url: "https://a.example" },
          { title: "No URL" },
          { title: "One again", url: "https://a.example" },
          { title: "Two", url: "https://b.example" },
          { title: "Three", url: "https://c.example" },
        ],
      },
      2
    );

    expect(results).toEqual([
      { title: "One", url: "https://a.example" },
      { title: "Two", url: "https://b.example" },
    ]);
  });

  test("reads a bare array response", () => {
    expect(
      parseCustomWebSearchResults(
        [{ name: "Item", uri: "https://x.example" }],
        5
      )
    ).toEqual([{ title: "Item", url: "https://x.example" }]);
  });
});
