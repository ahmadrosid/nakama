import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import type { TeamsActivity } from "./chat-handler";
import { startTeamsApp, type TeamsAppHandle } from "./teams-app";

// The SDK verifies these tokens itself, against keys it fetches from the
// discovery endpoint below. Nothing here stubs or skips that verification.

const CLIENT_ID = "22222222-2222-4222-8222-222222222222";

const ISSUER = "https://api.botframework.com";

const SERVICE_URL = "https://smba.trafficmanager.net/teams/";

const KID = "fixture-key";

const trusted = generateKeyPairSync("rsa", { modulusLength: 2048 });

const stranger = generateKeyPairSync("rsa", { modulusLength: 2048 });

let keyServer: ReturnType<typeof Bun.serve>;

let app: TeamsAppHandle;

const received: TeamsActivity[] = [];

function base64url(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url");
}

interface TokenClaims {
  aud: string;
  exp: number;
  iss: string;
  nbf: number;
  serviceurl: string;
}

function signToken(
  claims: TokenClaims,
  privateKey: KeyObject = trusted.privateKey
): string {
  const header = base64url(
    JSON.stringify({ alg: "RS256", kid: KID, typ: "JWT" })
  );

  const payload = base64url(JSON.stringify(claims));

  const signature = sign(
    "RSA-SHA256",
    Buffer.from(`${header}.${payload}`),
    privateKey
  );

  return `${header}.${payload}.${base64url(signature)}`;
}

function claims(patch: Partial<TokenClaims> = {}): TokenClaims {
  const now = Math.floor(Date.now() / 1000);

  return {
    aud: CLIENT_ID,
    exp: now + 600,
    iss: ISSUER,
    nbf: now - 60,
    serviceurl: SERVICE_URL,
    ...patch,
  };
}

function message(id: string) {
  return {
    channelId: "msteams",
    conversation: {
      conversationType: "personal",
      id: `conv_${id}`,
      tenantId: "33333333-3333-4333-8333-333333333333",
    },
    from: {
      aadObjectId: "11111111-1111-4111-8111-111111111111",
      id: "u1",
      role: "user",
    },
    id,
    recipient: { id: "bot", role: "bot" },
    serviceUrl: SERVICE_URL,
    text: "hello",
    type: "message",
  };
}

function post(id: string, token: string) {
  return fetch(`http://127.0.0.1:${app.port}/api/messages`, {
    body: JSON.stringify(message(id)),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
}

async function waitFor(check: () => boolean, ms = 2000): Promise<boolean> {
  const deadline = Date.now() + ms;

  while (Date.now() < deadline) {
    if (check()) {
      return true;
    }

    await Bun.sleep(20);
  }

  return check();
}

beforeAll(async () => {
  const jwk = trusted.publicKey.export({ format: "jwk" });

  keyServer = Bun.serve({
    fetch: (request) => {
      const { pathname } = new URL(request.url);

      return pathname.endsWith("/keys")
        ? Response.json({
            keys: [{ ...jwk, alg: "RS256", kid: KID, use: "sig" }],
          })
        : new Response("not found", { status: 404 });
    },
    hostname: "127.0.0.1",
    port: 0,
  });

  const base = `http://127.0.0.1:${keyServer.port}`;

  app = await startTeamsApp({
    cloud: {
      agenticIdentityBotScope: "https://api.botframework.com/.default",
      botScope: "https://api.botframework.com/.default",
      graphScope: "https://graph.microsoft.com/.default",
      loginEndpoint: base,
      loginTenant: "botframework.com",
      openIdMetadataUrl: `${base}/v1/.well-known/openidconfiguration`,
      tokenIssuer: ISSUER,
      tokenServiceUrl: base,
    },
    config: {
      clientId: CLIENT_ID,
      clientSecret: "teams-secret",
      tenantId: "33333333-3333-4333-8333-333333333333",
    },
    onActivity: async (activity) => {
      received.push(activity);
    },
  });
});

afterAll(async () => {
  await app.stop();
  keyServer.stop();
});

describe("teams app service token verification", () => {
  test("a correctly signed token reaches the handler", async () => {
    const response = await post("act_valid", signToken(claims()));

    expect(response.status).toBeLessThan(300);
    expect(
      await waitFor(() => received.some((a) => a.id === "act_valid"))
    ).toBe(true);
  });

  for (const [name, token] of [
    [
      "an expired token",
      () => signToken(claims({ exp: Math.floor(Date.now() / 1000) - 3600 })),
    ],
    [
      "a token for another bot",
      () => signToken(claims({ aud: "99999999-9999-4999-8999-999999999999" })),
    ],
    [
      "a token from another issuer",
      () => signToken(claims({ iss: "https://evil.example.com" })),
    ],
    [
      "a token signed by an unknown key",
      () => signToken(claims(), stranger.privateKey),
    ],
    [
      "a token for another service url",
      () => signToken(claims({ serviceurl: "https://evil.example.com/" })),
    ],
  ] as const) {
    test(`${name} never reaches the handler`, async () => {
      const id = `act_${name.replaceAll(" ", "_")}`;
      const response = await post(id, token());

      expect(response.status).toBe(401);
      expect(await waitFor(() => received.some((a) => a.id === id), 300)).toBe(
        false
      );
    });
  }
});
