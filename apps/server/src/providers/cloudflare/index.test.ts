import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  CLOUDFLARE_API_ROOT,
  createCloudflareProvider,
  resolveCloudflareBaseUrl,
} from "./index";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Cloudflare provider", () => {
  test("generateChat hits the Workers AI OpenAI-compatible endpoint", async () => {
    const fetchMock = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe(
          "https://api.cloudflare.com/client/v4/accounts/abc123/ai/v1/chat/completions"
        );
        expect(new Headers(init?.headers).get("Authorization")).toBe(
          "Bearer test-key"
        );
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          messages?: Array<{ content: string; role: string }>;
          model?: string;
        };
        expect(body.model).toBe("@cf/meta/llama-3.3-70b-instruct-fp8-fast");
        expect(body.messages?.[0]).toEqual({
          content: "You are helpful.",
          role: "system",
        });
        return Response.json({
          choices: [{ message: { content: "Hello from Workers AI" } }],
          usage: { completion_tokens: 3, prompt_tokens: 5 },
        });
      }
    );

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = createCloudflareProvider({
      accountId: "abc123",
      apiKey: "test-key",
      model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    });

    const result = await provider.generateChat({
      messages: [{ content: "Hi", role: "user" }],
      system: "You are helpful.",
    });

    expect(result.assistantMessage.content).toBe("Hello from Workers AI");
    expect(fetchMock).toHaveBeenCalled();
  });

  test("generateText requests JSON by default", async () => {
    const fetchMock = mock(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          response_format?: { type: string };
        };
        expect(body.response_format).toEqual({ type: "json_object" });
        return Response.json({
          choices: [{ message: { content: '{"ok":true}' } }],
        });
      }
    );

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = createCloudflareProvider({
      accountId: "abc123",
      apiKey: "test-key",
      model: "@cf/meta/llama-3.1-8b-instruct",
    });

    const result = await provider.generateText({
      prompt: "Return ok",
      system: "You return JSON.",
    });

    expect(result.content).toBe('{"ok":true}');
  });

  test("throws a labeled error on non-OK responses", async () => {
    globalThis.fetch = mock(async () =>
      Response.json({ error: "bad request" }, { status: 400 })
    ) as unknown as typeof fetch;

    const provider = createCloudflareProvider({
      accountId: "abc123",
      apiKey: "test-key",
      model: "@cf/meta/llama-3.1-8b-instruct",
    });

    await expect(
      provider.generateText({ prompt: "Hi", system: "Be helpful." })
    ).rejects.toThrow(/Cloudflare/);
  });

  test("prefers the instance base URL over the env account ID", () => {
    expect(
      resolveCloudflareBaseUrl("env-account", {
        apiKey: "key",
        baseUrl: `${CLOUDFLARE_API_ROOT}/from-config/ai/v1`,
        createdAt: new Date(0).toISOString(),
        id: "cf-1",
        label: "Cloudflare",
        type: "cloudflare",
      })
    ).toBe(`${CLOUDFLARE_API_ROOT}/from-config/ai/v1`);
  });

  test("falls back to CLOUDFLARE_ACCOUNT_ID when the instance has no base URL", () => {
    expect(resolveCloudflareBaseUrl("env-account")).toBe(
      `${CLOUDFLARE_API_ROOT}/env-account/ai/v1`
    );
  });

  test("throws when neither instance base URL nor account ID is set", () => {
    expect(() => resolveCloudflareBaseUrl("")).toThrow(/base_url/);
  });
});
