import { afterEach, describe, expect, test } from "bun:test";
import {
  CHATGPT_JWT_CLAIM_PATH,
  fetchChatgptCodexModels,
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

  test("refreshes a rejected token despite a future expiry and saves it before retrying", async () => {
    const accessToken = buildJwt({
      [CHATGPT_JWT_CLAIM_PATH]: { chatgpt_account_id: "acct_1" },
    });
    let saved = false;
    let modelRequests = 0;
    let refreshRequests = 0;
    globalThis.fetch = (async (input, init) => {
      if (String(input).includes("/oauth/token")) {
        refreshRequests++;
        expect(
          new URLSearchParams(String(init?.body)).get("refresh_token")
        ).toBe("refresh");
        return Response.json({
          access_token: accessToken,
          expires_in: 3600,
          refresh_token: "replacement",
        });
      }
      modelRequests++;
      if (modelRequests === 1) {
        return new Response(null, { status: 401 });
      }
      expect(saved).toBe(true);
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        `Bearer ${accessToken}`
      );
      return Response.json({ models: [{ slug: "gpt-5.4" }] });
    }) as typeof fetch;

    const models = await fetchChatgptCodexModels(
      {
        accessToken: "rejected-token",
        accountId: "acct_1",
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        refreshToken: "refresh",
      },
      (oauth) => {
        expect(oauth.accessToken).toBe(accessToken);
        expect(oauth.refreshToken).toBe("replacement");
        saved = true;
        return Promise.resolve();
      }
    );
    expect(models.map((model) => model.id)).toEqual(["gpt-5.4"]);
    expect(modelRequests).toBe(2);
    expect(refreshRequests).toBe(1);
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

  test.each(["refresh rejected", "retry rejected"])(
    "stops when %s and asks for reconnection",
    async (failure) => {
      let modelRequests = 0;
      let refreshRequests = 0;
      let saved = 0;
      globalThis.fetch = (async (input) => {
        if (String(input).includes("/oauth/token")) {
          refreshRequests++;
          if (failure === "refresh rejected") {
            return new Response(null, { status: 400 });
          }
          return Response.json({
            access_token: buildJwt({
              [CHATGPT_JWT_CLAIM_PATH]: { chatgpt_account_id: "acct_1" },
            }),
            expires_in: 3600,
            refresh_token: "replacement",
          });
        }
        modelRequests++;
        return new Response(null, { status: 401 });
      }) as typeof fetch;
      await expect(
        fetchChatgptCodexModels(
          {
            accessToken: "rejected",
            accountId: "acct_1",
            expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
            refreshToken: "refresh",
          },
          () => {
            saved++;
            return Promise.resolve();
          }
        )
      ).rejects.toMatchObject({ status: 400 });
      expect(refreshRequests).toBe(1);
      expect(modelRequests).toBe(failure === "refresh rejected" ? 1 : 2);
      expect(saved).toBe(failure === "refresh rejected" ? 0 : 1);
    }
  );
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
