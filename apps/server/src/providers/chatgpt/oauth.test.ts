import { afterEach, describe, expect, test } from "bun:test";
import {
  CHATGPT_JWT_CLAIM_PATH,
  parseChatgptCodexModelsPayload,
  readChatgptAccountIdFromAccessToken,
} from "./oauth";

function buildJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "none", typ: "JWT" })
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.signature`;
}

describe("fetchChatgptCodexModels", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("throws when Codex returns an error status", async () => {
    globalThis.fetch = (async () =>
      new Response("nope", { status: 403 })) as typeof fetch;

    const { fetchChatgptCodexModels } = await import("./oauth");

    await expect(
      fetchChatgptCodexModels({
        accessToken: "token",
        accountId: "acct_1",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        refreshToken: "refresh",
      })
    ).rejects.toThrow("ChatGPT models failed (403)");
  });
});

describe("parseChatgptCodexModelsPayload", () => {
  test("reads slug, display name, and skips unsupported models", () => {
    expect(
      parseChatgptCodexModelsPayload({
        models: [
          { display_name: "GPT-5.4", slug: "gpt-5.4" },
          { id: "hidden", supported_in_api: false },
          { display_name: "GPT-5.4 mini", slug: "gpt-5.4-mini" },
        ],
      })
    ).toEqual([
      { id: "gpt-5.4", name: "GPT-5.4", supportsVision: true },
      { id: "gpt-5.4-mini", name: "GPT-5.4 mini", supportsVision: true },
    ]);
  });
});

describe("readChatgptAccountIdFromAccessToken", () => {
  test("reads chatgpt_account_id from access token payload", () => {
    const token = buildJwt({
      [CHATGPT_JWT_CLAIM_PATH]: {
        chatgpt_account_id: "acct_123",
      },
    });

    expect(readChatgptAccountIdFromAccessToken(token)).toBe("acct_123");
  });

  test("returns null when claim is missing", () => {
    expect(readChatgptAccountIdFromAccessToken(buildJwt({}))).toBeNull();
  });
});

describe("completeChatgptDeviceAuth", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("exchanges device auth for oauth credentials", async () => {
    const token = buildJwt({
      [CHATGPT_JWT_CLAIM_PATH]: {
        chatgpt_account_id: "acct_456",
      },
    });

    globalThis.fetch = (async (input, init) => {
      const url = String(input);

      if (url.includes("/deviceauth/token")) {
        return new Response(
          JSON.stringify({
            authorization_code: "auth-code",
            code_verifier: "verifier",
          }),
          { status: 200 }
        );
      }

      if (url.includes("/oauth/token")) {
        expect(init?.method).toBe("POST");
        return new Response(
          JSON.stringify({
            access_token: token,
            expires_in: 3600,
            refresh_token: "refresh-token",
          }),
          { status: 200 }
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const { completeChatgptDeviceAuth } = await import("./oauth");
    const result = await completeChatgptDeviceAuth(
      {
        deviceAuthId: "device-auth-id",
        intervalSeconds: 0,
        userCode: "ABCD-1234",
      },
      { timeoutMs: 1000 }
    );

    expect(result.accountId).toBe("acct_456");
    expect(result.refreshToken).toBe("refresh-token");
    expect(result.accessToken).toBe(token);
  });
});
