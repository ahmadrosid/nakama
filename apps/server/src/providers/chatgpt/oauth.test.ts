import { afterEach, describe, expect, test } from "bun:test";
import {
  CHATGPT_JWT_CLAIM_PATH,
  readChatgptAccountIdFromAccessToken,
} from "./oauth";

function buildJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "none", typ: "JWT" })
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.signature`;
}

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
