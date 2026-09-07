import { afterEach, expect, test } from "bun:test";
import { createXaiProvider } from "./index";
import {
  completeXaiOAuthDeviceSession,
  fetchXaiOAuthModels,
  refreshXaiOAuthToken,
  resolveXaiOAuthCredentials,
  startXaiOAuthDeviceSession,
} from "./oauth";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const tokenPayload = {
  access_token: "access",
  expires_in: 900,
  refresh_token: "refresh",
};
const devicePayload = {
  device_code: "secret-device-code",
  expires_in: 60,
  interval: 1,
  user_code: "CODE",
  verification_uri: "https://accounts.x.ai/oauth2/device",
  verification_uri_complete:
    "https://accounts.x.ai/oauth2/device?user_code=CODE",
};
const credentials = {
  accessToken: "access",
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  refreshToken: "refresh",
};
function mockFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>
) {
  globalThis.fetch = ((url, init) =>
    Promise.resolve(handler(String(url), init))) as typeof fetch;
}

test("device session is bound to its owner and can only be completed once", async () => {
  let polls = 0;
  mockFetch((url, init) => {
    expect(init?.redirect).toBe("error");
    const form = init?.body as URLSearchParams;
    expect(form.get("client_id")).toBe("b1a00492-073a-47ea-816f-4c329264a828");
    if (url.endsWith("/device/code")) {
      return Response.json(devicePayload);
    }
    polls++;
    expect(form.get("device_code")).toBe("secret-device-code");
    expect(form.get("grant_type")).toBe(
      "urn:ietf:params:oauth:grant-type:device_code"
    );
    return Response.json(tokenPayload);
  });
  const start = await startXaiOAuthDeviceSession("alice/org1");
  expect(start.verificationUri).toBe(
    "https://accounts.x.ai/oauth2/device?user_code=CODE"
  );
  expect(JSON.stringify(start)).not.toContain("secret-device-code");
  await expect(
    completeXaiOAuthDeviceSession(start.sessionId, "bob/org1")
  ).rejects.toThrow();
  await expect(
    completeXaiOAuthDeviceSession(start.sessionId, "alice/org2")
  ).rejects.toThrow();
  const pending = completeXaiOAuthDeviceSession(start.sessionId, "alice/org1");
  await expect(
    completeXaiOAuthDeviceSession(start.sessionId, "alice/org1")
  ).rejects.toThrow();
  const result = await pending;
  expect(result.accessToken).toBe("access");
  expect(Date.parse(result.expiresAt)).toBeGreaterThan(Date.now());
  expect(polls).toBe(1);
});

test("pending and slow_down wait before polling again", async () => {
  const times: number[] = [];
  mockFetch((url) => {
    if (url.endsWith("/device/code")) {
      return Response.json(devicePayload);
    }
    times.push(Date.now());
    if (times.length === 1) {
      return Response.json({ error: "authorization_pending" }, { status: 400 });
    }
    if (times.length === 2) {
      return Response.json({ error: "slow_down" }, { status: 400 });
    }
    return Response.json(tokenPayload);
  });
  const start = await startXaiOAuthDeviceSession("pending");
  const result = await completeXaiOAuthDeviceSession(
    start.sessionId,
    "pending"
  );
  expect(result.refreshToken).toBe("refresh");
  expect(times[2]! - times[1]!).toBeGreaterThanOrEqual(5900);
}, 12_000);

for (const error of ["access_denied", "expired_token"]) {
  test(`stops polling after ${error}`, async () => {
    let polls = 0;
    mockFetch((url) => {
      if (url.endsWith("/device/code")) {
        return Response.json(devicePayload);
      }
      polls++;
      return Response.json({ error }, { status: 400 });
    });
    const start = await startXaiOAuthDeviceSession(error);
    await expect(
      completeXaiOAuthDeviceSession(start.sessionId, error)
    ).rejects.toThrow();
    expect(polls).toBe(1);
  });
}

test("expired and cancelled sessions do not reach the token endpoint", async () => {
  let polls = 0;
  mockFetch((url) => {
    if (url.endsWith("/device/code")) {
      return Response.json({ ...devicePayload, expires_in: 0.01 });
    }
    polls++;
    return Response.json(tokenPayload);
  });
  const start = await startXaiOAuthDeviceSession("expired");
  await new Promise((resolve) => setTimeout(resolve, 20));
  await expect(
    completeXaiOAuthDeviceSession(start.sessionId, "expired")
  ).rejects.toThrow();
  const next = await startXaiOAuthDeviceSession("cancelled");
  await expect(
    completeXaiOAuthDeviceSession(
      next.sessionId,
      "cancelled",
      AbortSignal.abort()
    )
  ).rejects.toThrow();
  expect(polls).toBe(0);
});

test("rejects untrusted verification URLs and malformed device responses", async () => {
  for (const override of [
    {
      verification_uri: "https://evil.example/device",
      verification_uri_complete: "https://evil.example/device",
    },
    { expires_in: -1 },
    { interval: "1" },
  ]) {
    mockFetch(() => Response.json({ ...devicePayload, ...override }));
    await expect(startXaiOAuthDeviceSession("invalid")).rejects.toThrow();
  }
});

test("refresh keeps a non-rotated grant and rejects incomplete tokens", async () => {
  mockFetch((_url, init) => {
    expect((init?.body as URLSearchParams | undefined)?.get("grant_type")).toBe(
      "refresh_token"
    );
    return Response.json({ access_token: "new", expires_in: 900 });
  });
  expect((await refreshXaiOAuthToken("old")).refreshToken).toBe("old");
  mockFetch(() => Response.json({ refresh_token: "secret" }));
  await expect(refreshXaiOAuthToken("old")).rejects.toThrow();
  mockFetch(() => new Response("sensitive token", { status: 403 }));
  await expect(refreshXaiOAuthToken("old")).rejects.not.toThrow(
    "sensitive token"
  );
});

test("concurrent refreshes share one exchange and persist before returning", async () => {
  let exchanges = 0;
  let saves = 0;
  let current = { ...credentials, expiresAt: "2020-01-01T00:00:00.000Z" };
  mockFetch(async () => {
    exchanges++;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return Response.json({ ...tokenPayload, refresh_token: "rotated" });
  });
  const resolve = () =>
    resolveXaiOAuthCredentials(
      () => current,
      async (value) => {
        saves++;
        current = value;
      }
    );
  const results = await Promise.all([resolve(), resolve(), resolve()]);
  expect(exchanges).toBe(1);
  expect(saves).toBe(1);
  expect(results.every((value) => value.refreshToken === "rotated")).toBe(true);
  await resolve();
  expect(exchanges).toBe(1);
});

test("discovers language models using the subscription bearer", async () => {
  mockFetch((url, init) => {
    expect(url).toBe("https://api.x.ai/v1/language-models");
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer access"
    );
    return Response.json({ models: [{ id: "grok-4.6" }] });
  });
  expect(await fetchXaiOAuthModels(credentials)).toEqual([
    { id: "grok-4.6", name: "grok-4.6" },
  ]);
});

test("subscription inference uses Responses API with tool calls and usage", async () => {
  mockFetch((url, init) => {
    expect(url).toBe("https://api.x.ai/v1/responses");
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer access");
    expect(headers.has("ChatGPT-Account-ID")).toBe(false);
    const body = JSON.parse(String(init?.body));
    expect(body.tools[0].name).toBe("lookup");
    expect(body.store).toBe(false);
    return Response.json({
      output: [
        {
          arguments: '{"q":"hello"}',
          call_id: "call1",
          name: "lookup",
          type: "function_call",
        },
      ],
      usage: { input_tokens: 12, output_tokens: 3, total_tokens: 15 },
    });
  });
  const provider = createXaiProvider({
    getOAuth: () => credentials,
    model: "grok-4.6",
  });
  const result = await provider.generateChat!({
    messages: [{ content: "hello", role: "user" }],
    system: "help",
    tools: [
      {
        description: "Lookup",
        name: "lookup",
        parameters: { properties: { q: { type: "string" } }, type: "object" },
      },
    ],
  });
  expect(result.toolCalls?.[0]?.name).toBe("lookup");
  expect(result.usage?.totalTokens).toBe(15);
});

test("an in-flight refresh cannot overwrite a reconnected account", async () => {
  let current = { ...credentials, expiresAt: "2020-01-01T00:00:00.000Z" };
  let saves = 0;
  mockFetch(async () => {
    current = { ...credentials, refreshToken: "new-account" };
    return Response.json({
      ...tokenPayload,
      refresh_token: "old-account-rotated",
    });
  });
  const result = await resolveXaiOAuthCredentials(
    () => current,
    async () => {
      saves++;
    }
  );
  expect(result.refreshToken).toBe("new-account");
  expect(saves).toBe(0);
});
