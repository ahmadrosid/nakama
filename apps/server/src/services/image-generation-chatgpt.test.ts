import { describe, expect, test } from "bun:test";
import { NakamaApiError, type UserConfig } from "@nakama/core";
import {
  generateImageWithOpenAI,
  resolveImageGenerationSelection,
} from "./image-generation";

const chatgptResponsesUrl = "https://chatgpt.com/backend-api/codex/responses";

const chatgptOAuth = {
  accessToken: "chatgpt-access",
  accountId: "acct-1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  refreshToken: "chatgpt-refresh",
};

const chatgptConfig = (overrides?: Partial<UserConfig>): UserConfig => ({
  defaultProviderId: "p-chatgpt",
  providers: [
    {
      apiKey: "",
      chatgptAccessToken: chatgptOAuth.accessToken,
      chatgptAccountId: chatgptOAuth.accountId,
      chatgptRefreshToken: chatgptOAuth.refreshToken,
      chatgptTokenExpiresAt: chatgptOAuth.expiresAt,
      createdAt: "2026-01-01T00:00:00.000Z",
      id: "p-chatgpt",
      label: "ChatGPT",
      type: "chatgpt",
    },
  ],
  ...overrides,
});

function tokenWithAccount(): string {
  const claims = Buffer.from(
    JSON.stringify({
      "https://api.openai.com/auth": { chatgpt_account_id: "acct-1" },
    })
  ).toString("base64url");

  return `h.${claims}.s`;
}

function sseBody(events: unknown[]): string {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
}

const chatgptImageEvents = [
  { type: "response.created" },
  {
    item: {
      output_format: "png",
      result: Buffer.from("png-bytes").toString("base64"),
      revised_prompt: "A red cat on a blue box.",
      size: "1199x1312",
      status: "completed",
      type: "image_generation_call",
    },
    type: "response.output_item.done",
  },
  {
    response: {
      tool_usage: { image_gen: { input_tokens: 46, output_tokens: 472 } },
    },
    type: "response.completed",
  },
];

describe("resolveImageGenerationSelection on a ChatGPT subscription", () => {
  test("resolves <chatgptProviderId>::<chatModelId> on a connected ChatGPT provider", () => {
    const selection = resolveImageGenerationSelection(
      chatgptConfig({ imageModel: "p-chatgpt::gpt-6-sol" })
    );

    expect(selection?.model).toBe("gpt-6-sol");
    expect(selection?.instance.id).toBe("p-chatgpt");
    expect(selection?.chatgptOAuth).toEqual(chatgptOAuth);
  });

  test("rejects a ChatGPT provider that is not connected", () => {
    const config = chatgptConfig({ imageModel: "p-chatgpt::gpt-6-sol" });
    expect(() =>
      resolveImageGenerationSelection({
        ...config,
        providers: config.providers.map((provider) => ({
          ...provider,
          chatgptRefreshToken: "",
        })),
      })
    ).toThrow(NakamaApiError);
  });
});

describe("generateImageWithOpenAI on a ChatGPT subscription", () => {
  test("calls the hosted image tool and returns the image", async () => {
    let requestedUrl = "";
    let requestHeaders = new Headers();
    let requestBodyText = "";
    const originalFetch = globalThis.fetch;
    // SAFETY: The test fixture matches the contract used by this test.
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      requestedUrl = String(input);
      requestHeaders = new Headers(init?.headers);
      requestBodyText = String(init?.body);

      return new Response(sseBody(chatgptImageEvents), {
        headers: { "Content-Type": "text/event-stream" },
        status: 200,
      });
    }) as typeof fetch;

    try {
      const result = await generateImageWithOpenAI({
        apiKey: chatgptOAuth.accessToken,
        chatgpt: { oauth: chatgptOAuth },
        model: "gpt-6-sol",
        prompt: "a red cat on a blue box",
        size: "1024x1536",
      });

      expect(Buffer.from(result.data).toString()).toBe("png-bytes");
      expect(result.mediaType).toBe("image/png");
      expect(result.model).toBe("gpt-6-sol");
      expect(result.size).toBe("1199x1312");
      expect(result.revisedPrompt).toBe("A red cat on a blue box.");
      expect(result.usage).toEqual({ inputTokens: 46, outputTokens: 472 });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requestedUrl).toBe(chatgptResponsesUrl);
    expect(requestHeaders.get("Authorization")).toBe("Bearer chatgpt-access");
    expect(requestHeaders.get("ChatGPT-Account-ID")).toBe("acct-1");
    const requestBody = JSON.parse(requestBodyText);
    expect(requestBody.model).toBe("gpt-6-sol");
    expect(requestBody.stream).toBe(true);
    expect(requestBody.tool_choice).toEqual({ type: "image_generation" });
    expect(requestBody.tools).toEqual([
      { output_format: "png", size: "1024x1536", type: "image_generation" },
    ]);
  });

  test("refreshes an expiring token and saves it before the call", async () => {
    const saved: string[] = [];
    let usedToken = "";
    const originalFetch = globalThis.fetch;
    // SAFETY: The test fixture matches the contract used by this test.
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      if (String(input).includes("/oauth/token")) {
        const claims = Buffer.from(
          JSON.stringify({
            "https://api.openai.com/auth": { chatgpt_account_id: "acct-1" },
          })
        ).toString("base64url");

        return Response.json({
          access_token: `h.${claims}.s`,
          expires_in: 3600,
          refresh_token: "new-refresh",
        });
      }

      usedToken = new Headers(init?.headers).get("Authorization") ?? "";

      return new Response(sseBody(chatgptImageEvents), { status: 200 });
    }) as typeof fetch;

    try {
      await generateImageWithOpenAI({
        apiKey: chatgptOAuth.accessToken,
        chatgpt: {
          oauth: { ...chatgptOAuth, expiresAt: "2000-01-01T00:00:00.000Z" },
          onTokenRefresh: async (oauth) => {
            saved.push(oauth.refreshToken);
          },
        },
        model: "gpt-6-sol",
        prompt: "a cat",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(saved).toEqual(["new-refresh"]);
    expect(usedToken.startsWith("Bearer h.")).toBe(true);
  });

  test("refreshes and retries once when a live token is rejected", async () => {
    const saved: string[] = [];
    const usedTokens: string[] = [];
    const originalFetch = globalThis.fetch;
    // SAFETY: The test fixture matches the contract used by this test.
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      if (String(input).includes("/oauth/token")) {
        const claims = Buffer.from(
          JSON.stringify({
            "https://api.openai.com/auth": { chatgpt_account_id: "acct-1" },
          })
        ).toString("base64url");

        return Response.json({
          access_token: `h.${claims}.s`,
          expires_in: 3600,
          refresh_token: "rotated-refresh",
        });
      }

      const token = new Headers(init?.headers).get("Authorization") ?? "";
      usedTokens.push(token);

      if (token === "Bearer chatgpt-access") {
        return new Response("", { status: 401 });
      }

      return new Response(sseBody(chatgptImageEvents), { status: 200 });
    }) as typeof fetch;

    try {
      const result = await generateImageWithOpenAI({
        apiKey: chatgptOAuth.accessToken,
        chatgpt: {
          oauth: { ...chatgptOAuth, refreshToken: "retry-refresh" },
          onTokenRefresh: async (oauth) => {
            saved.push(oauth.refreshToken);
          },
        },
        model: "gpt-6-sol",
        prompt: "a cat",
      });

      expect(Buffer.from(result.data).toString()).toBe("png-bytes");
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(saved).toEqual(["rotated-refresh"]);
    expect(usedTokens).toHaveLength(2);
    expect(usedTokens[1]?.startsWith("Bearer h.")).toBe(true);
  });

  test("asks to reconnect when the refresh after a 401 fails", async () => {
    const originalFetch = globalThis.fetch;
    // SAFETY: The test fixture matches the contract used by this test.
    globalThis.fetch = (async (input: RequestInfo | URL) =>
      String(input).includes("/oauth/token")
        ? new Response(null, { status: 400 })
        : new Response("", { status: 401 })) as typeof fetch;

    try {
      await expect(
        generateImageWithOpenAI({
          apiKey: chatgptOAuth.accessToken,
          chatgpt: {
            oauth: { ...chatgptOAuth, refreshToken: "dead-refresh" },
          },
          model: "gpt-6-sol",
          prompt: "a cat",
        })
      ).rejects.toMatchObject({ status: 400 });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("reports an upstream 403 as a client error", async () => {
    const originalFetch = globalThis.fetch;
    // SAFETY: The test fixture matches the contract used by this test.
    globalThis.fetch = (async () =>
      new Response("<!doctype html><html></html>", {
        status: 403,
      })) as typeof fetch;

    try {
      await expect(
        generateImageWithOpenAI({
          apiKey: chatgptOAuth.accessToken,
          chatgpt: { oauth: chatgptOAuth },
          model: "gpt-6-sol",
          prompt: "a cat",
        })
      ).rejects.toMatchObject({ status: 400 });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("fails when the stream reports an error", async () => {
    const originalFetch = globalThis.fetch;
    // SAFETY: The test fixture matches the contract used by this test.
    globalThis.fetch = (async (_url: string, _init: RequestInit) =>
      new Response(
        sseBody([
          {
            response: { error: { message: "image limit reached" } },
            type: "response.failed",
          },
        ]),
        { status: 200 }
      )) as typeof fetch;

    try {
      await expect(
        generateImageWithOpenAI({
          apiKey: chatgptOAuth.accessToken,
          chatgpt: { oauth: chatgptOAuth },
          model: "gpt-6-sol",
          prompt: "a cat",
        })
      ).rejects.toThrow(NakamaApiError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("fails when the stream has no image", async () => {
    const originalFetch = globalThis.fetch;
    // SAFETY: The test fixture matches the contract used by this test.
    globalThis.fetch = (async (_url: string, _init: RequestInit) =>
      new Response(sseBody([{ type: "response.completed" }]), {
        status: 200,
      })) as typeof fetch;

    try {
      await expect(
        generateImageWithOpenAI({
          apiKey: chatgptOAuth.accessToken,
          chatgpt: { oauth: chatgptOAuth },
          model: "gpt-6-sol",
          prompt: "a cat",
        })
      ).rejects.toThrow(NakamaApiError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("asks to reconnect when the refresh before the call fails", async () => {
    const originalFetch = globalThis.fetch;
    // SAFETY: The test fixture matches the contract used by this test.
    globalThis.fetch = (async (_input: RequestInfo | URL) =>
      new Response('{"error":"invalid_grant"}', {
        status: 400,
      })) as typeof fetch;

    try {
      await expect(
        generateImageWithOpenAI({
          apiKey: chatgptOAuth.accessToken,
          chatgpt: {
            oauth: {
              ...chatgptOAuth,
              expiresAt: "2000-01-01T00:00:00.000Z",
              refreshToken: "dead-before-call",
            },
          },
          model: "gpt-6-sol",
          prompt: "a cat",
        })
      ).rejects.toMatchObject({ status: 400 });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("keeps a failed token save apart from an expired sign-in", async () => {
    const originalFetch = globalThis.fetch;
    // SAFETY: The test fixture matches the contract used by this test.
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).includes("/oauth/token")) {
        return Response.json({
          access_token: tokenWithAccount(),
          expires_in: 3600,
          refresh_token: "saved-fails-refresh",
        });
      }

      return new Response("", { status: 401 });
    }) as typeof fetch;

    const saveError = new Error("disk full");

    try {
      await expect(
        generateImageWithOpenAI({
          apiKey: chatgptOAuth.accessToken,
          chatgpt: {
            oauth: { ...chatgptOAuth, refreshToken: "save-fails" },
            onTokenRefresh: () => Promise.reject(saveError),
          },
          model: "gpt-6-sol",
          prompt: "a cat",
        })
      ).rejects.toBe(saveError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("uses tokens another call rotated instead of redeeming a spent one", async () => {
    let refreshRequests = 0;
    const usedTokens: string[] = [];
    const originalFetch = globalThis.fetch;
    // SAFETY: The test fixture matches the contract used by this test.
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      if (String(input).includes("/oauth/token")) {
        refreshRequests++;

        return new Response(null, { status: 400 });
      }

      const token = new Headers(init?.headers).get("Authorization") ?? "";
      usedTokens.push(token);

      return token === "Bearer chatgpt-access"
        ? new Response("", { status: 401 })
        : new Response(sseBody(chatgptImageEvents), { status: 200 });
    }) as typeof fetch;

    try {
      const result = await generateImageWithOpenAI({
        apiKey: chatgptOAuth.accessToken,
        chatgpt: {
          getOAuth: () => ({
            ...chatgptOAuth,
            accessToken: "rotated-access",
            refreshToken: "rotated-refresh",
          }),
          oauth: chatgptOAuth,
        },
        model: "gpt-6-sol",
        prompt: "a cat",
      });

      expect(Buffer.from(result.data).toString()).toBe("png-bytes");
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(refreshRequests).toBe(0);
    expect(usedTokens).toEqual([
      "Bearer chatgpt-access",
      "Bearer rotated-access",
    ]);
  });

  test("stops waiting on a stalled token refresh when the turn stops", async () => {
    const originalFetch = globalThis.fetch;
    // SAFETY: The test fixture matches the contract used by this test.
    globalThis.fetch = ((_input: RequestInfo | URL, _init?: RequestInit) =>
      new Promise<Response>(() => undefined)) as typeof fetch;
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);

    try {
      await expect(
        generateImageWithOpenAI({
          apiKey: chatgptOAuth.accessToken,
          chatgpt: {
            oauth: {
              ...chatgptOAuth,
              expiresAt: "2000-01-01T00:00:00.000Z",
              refreshToken: "stalled-refresh",
            },
          },
          model: "gpt-6-sol",
          prompt: "a cat",
          signal: controller.signal,
        })
      ).rejects.toThrow();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
