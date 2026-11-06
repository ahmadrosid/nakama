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

const record = async (activity: TeamsActivity) => {
  received.push(activity);
};

/** What the app runs for each delivered message; a test may swap it. */
let runTurn: (activity: TeamsActivity) => Promise<void> = record;

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

function message(id: string, conversationId = `conv_${id}`) {
  return {
    channelId: "msteams",
    conversation: {
      conversationType: "personal",
      id: conversationId,
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

/** Fields a test sets on the message activity, as Teams would send them. */
interface MessagePatch {
  attachments?: { content: string; contentType: string }[];
  conversation?: { conversationType: string; id: string; tenantId: string };
  entities?: {
    mentioned?: { id: string; name: string };
    text?: string;
    type: "mention";
  }[];
  text?: string;
  textFormat?: "plain";
}

function post(
  id: string,
  token: string,
  conversationId?: string,
  patch: MessagePatch = {}
) {
  return fetch(`http://127.0.0.1:${app.port}/api/messages`, {
    body: JSON.stringify({ ...message(id, conversationId), ...patch }),
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
    onActivity: (activity) => runTurn(activity),
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

describe("teams app message text", () => {
  // The shape Teams desktop sends, from a sample payload on Microsoft Q&A:
  // plain text in `text`, and the same message as HTML in an attachment.
  test("a command arrives as the plain text, not the HTML copy", async () => {
    const response = await post("act_command", signToken(claims()), undefined, {
      attachments: [{ content: "<p>!stop</p>", contentType: "text/html" }],
      text: "!stop",
      textFormat: "plain",
    });

    expect(response.status).toBeLessThan(300);
    expect(
      await waitFor(() => received.some((a) => a.id === "act_command"))
    ).toBe(true);
    expect(received.find((a) => a.id === "act_command")?.text).toBe("!stop");
  });
});

describe("teams app channel mentions", () => {
  const conversation = {
    conversationType: "channel",
    id: "19:general@thread.tacv2;messageid=1001",
    tenantId: "33333333-3333-4333-8333-333333333333",
  };

  const mentionOf = (id: string, name = "Nakama") => ({
    mentioned: { id, name },
    text: `<at>${name}</at>`,
    type: "mention" as const,
  });

  async function deliver(id: string, patch: MessagePatch) {
    const response = await post(id, signToken(claims()), undefined, {
      conversation,
      ...patch,
    });

    expect(response.status).toBeLessThan(300);
    expect(await waitFor(() => received.some((a) => a.id === id))).toBe(true);

    return received.find((a) => a.id === id);
  }

  test("a mention of the bot is flagged and every bot tag is cut", async () => {
    const activity = await deliver("act_mention", {
      entities: [mentionOf("bot"), mentionOf("bot")],
      text: "<at>Nakama</at> <at>Nakama</at> !stop",
    });

    expect(activity?.mentionsBot).toBe(true);
    expect(activity?.text).toBe("!stop");
  });

  test("a mention without text is cut by the bot's name", async () => {
    const activity = await deliver("act_mention_no_text", {
      entities: [{ mentioned: { id: "bot", name: "Nakama" }, type: "mention" }],
      text: "<at>Nakama</at> summarise this thread",
    });

    expect(activity?.mentionsBot).toBe(true);
    expect(activity?.text).toBe("summarise this thread");
  });

  test("an activity that cannot be read holds no turn slot", async () => {
    // A mention without `mentioned` makes the SDK's mention check throw.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await post(
        `act_broken_${attempt}`,
        signToken(claims()),
        undefined,
        {
          conversation,
          entities: [{ type: "mention" }],
        }
      );

      expect(response.status).toBeGreaterThanOrEqual(500);
    }

    // The same thread has room for four turns, so a leaked slot per bad
    // activity would refuse this one.
    expect(
      (await deliver("act_after_broken", { entities: [mentionOf("bot")] }))
        ?.mentionsBot
    ).toBe(true);
  });

  test("a mention of someone else is not a mention of the bot", async () => {
    const activity = await deliver("act_mention_other", {
      entities: [mentionOf("someone-else")],
      text: "<at>Nakama</at> summarise this thread",
    });

    expect(activity?.mentionsBot).toBe(false);
    expect(activity?.text).toBe("<at>Nakama</at> summarise this thread");
  });
});

describe("teams app turn scheduling", () => {
  test("Teams is answered while the turn is still running", async () => {
    let release = () => {};

    runTurn = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });

    try {
      const answered = await Promise.race([
        post("act_slow", signToken(claims())).then(
          (response) => response.status
        ),
        Bun.sleep(2000).then(() => 0),
      ]);

      expect(answered).toBeGreaterThanOrEqual(200);
      expect(answered).toBeLessThan(300);
    } finally {
      runTurn = record;
      release();
    }
  });

  test("a chat with turns already waiting is refused, and other chats still get through", async () => {
    const releases: (() => void)[] = [];

    runTurn = () =>
      new Promise<void>((resolve) => {
        releases.push(resolve);
      });

    try {
      const statuses: number[] = [];

      // Four turns may wait in one chat; the fifth is refused, not dropped.
      for (let index = 0; index < 5; index += 1) {
        const response = await post(
          `act_busy_${index}`,
          signToken(claims()),
          "conv_busy"
        );

        statuses.push(response.status);
      }

      const quiet = await post("act_quiet", signToken(claims()), "conv_quiet");

      expect(statuses.slice(0, 4).every((status) => status < 300)).toBe(true);
      expect(statuses[4]).toBeGreaterThanOrEqual(500);
      expect(quiet.status).toBeLessThan(300);
      expect(releases).toHaveLength(5);
    } finally {
      runTurn = record;

      for (const release of releases) {
        release();
      }
    }
  });
});
