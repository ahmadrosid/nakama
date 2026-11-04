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
});
