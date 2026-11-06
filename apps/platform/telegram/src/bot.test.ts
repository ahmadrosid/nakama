import { afterEach, describe, expect, spyOn, test } from "bun:test";
import path from "node:path";
import { inspect } from "node:util";
import { NakamaClient } from "@nakama/client";
import { resetActiveStreamsForTests } from "@nakama/core/channel-active-stream";
import { ChannelSessionStore } from "@nakama/core/channel-session-store";
import { Bot } from "grammy";
import { TelegramAuthStore } from "./auth-store";
import { createBot, redactBotToken } from "./bot";
import { createChatHandler, resetChatLocksForTests } from "./chat-handler";
import {
  createMessageContext,
  createMockClient,
  createMultiTestOrgs,
  createTestOrgStore,
  TEST_BOT_INFO,
  withTempHome,
  writeTelegramConfigIni,
} from "./test-helpers";

type PollingUpdate = Parameters<Bot["handleUpdate"]>[0];

const TOKEN = "7654321098:AAF_fakeTokenValueDoNotUse_zzzz12345";

describe("redactBotToken", () => {
  // Use grammY's real network error, which includes the token in the request URL.
  test("keeps the bot token out of a logged grammY network error", async () => {
    let captured: unknown;

    try {
      await new Bot(TOKEN, {
        client: { apiRoot: "http://127.0.0.1:9" },
      }).api.getMe();
    } catch (error) {
      captured = error;
    }

    const logged = inspect(captured);
    expect(logged).toContain(TOKEN);
    expect(redactBotToken(logged, TOKEN)).not.toContain(TOKEN);
    expect(redactBotToken(logged, TOKEN)).toContain("/bot<redacted>/getMe");
  });

  test("leaves the text alone when no token is configured", () => {
    expect(redactBotToken("Network request for 'getMe' failed!", "")).toBe(
      "Network request for 'getMe' failed!"
    );
  });
});

afterEach(() => {
  resetActiveStreamsForTests();
  resetChatLocksForTests();
});

const BOT_INFO = {
  ...TEST_BOT_INFO,
  allows_users_to_create_topics: false,
  can_connect_to_business: false,
  can_join_groups: true,
  can_manage_bots: false,
  can_read_all_group_messages: false,
  first_name: "Test bot",
  has_main_web_app: false,
  has_topics_enabled: false,
  is_bot: true as const,
  supports_inline_queries: false,
  supports_join_request_queries: false,
  username: "mybot",
};

function message(id: number, chat: number, text: string) {
  return {
    message: {
      chat: { first_name: "User", id: chat, type: "private" as const },
      date: 0,
      from: { first_name: "User", id: 42, is_bot: false },
      message_id: id,
      text,
    },
    update_id: id,
  } satisfies PollingUpdate;
}

async function waitUntil(condition: () => boolean) {
  const end = Date.now() + 1500;

  while (!condition()) {
    if (Date.now() >= end) {
      throw new Error("Expected polling activity did not occur");
    }

    await Bun.sleep(5);
  }
}

async function withPolling(
  batches: PollingUpdate[][],
  check: (fixture: Awaited<ReturnType<typeof pollingFixture>>) => Promise<void>
) {
  await withTempHome(async (home) => {
    const fixture = await pollingFixture(home, batches);

    try {
      await check(fixture);
    } finally {
      const stopping = fixture.runner.stop();

      // A turn can still be waiting for the chat lock when shutdown begins.
      const drain = setInterval(() => {
        for (const control of fixture.mock.getStreamControls()) {
          control.complete();
        }
      }, 5);

      try {
        await stopping;
        await fixture.runner.running;
      } finally {
        clearInterval(drain);
        fixture.server.stop(true);
      }
    }
  });
}

async function pollingFixture(
  home: string,
  batches: PollingUpdate[][],
  failPolling = false
) {
  await writeTelegramConfigIni(home, { allowedUserIds: [42], botToken: TOKEN });
  const authStore = new TelegramAuthStore(null);
  const orgStore = createTestOrgStore(home);
  await orgStore.load();
  const mock = createMockClient({ autoComplete: false, streaming: true });
  const replies: number[] = [];
  let polls = 0;
  let webhookDeletes = 0;
  const errors: unknown[] = [];

  const server = Bun.serve({
    fetch: async (request) => {
      const method = new URL(request.url).pathname.split("/").at(-1);

      if (method === "deleteWebhook") {
        webhookDeletes += 1;

        const payload = await request.json();
        expect(payload.drop_pending_updates).not.toBe(true);
      }

      if (method === "getUpdates") {
        polls += 1;

        if (failPolling) {
          return Response.json({
            description: `Request failed at /bot${TOKEN}/getUpdates`,
            error_code: polls === 1 ? 500 : 401,
            ok: false,
          });
        }

        // Put later updates in a later HTTP poll, after the first turn starts.
        if (polls === 2) {
          await waitUntil(() => mock.calls.sendStream > 0 || errors.length > 0);
        }

        const updates = batches.shift() ?? [];

        if (updates.length === 0) {
          await Bun.sleep(10);
        }

        return Response.json({ ok: true, result: updates });
      }

      if (method === "sendMessage") {
        const payload = await request.json();
        replies.push(Number(payload.chat_id));

        const result = {
          chat: { id: payload.chat_id, type: "private" },
          date: 0,
          message_id: replies.length,
          text: payload.text,
        };

        return Response.json({ ok: true, result });
      }

      return Response.json({ ok: true, result: true });
    },
    hostname: "127.0.0.1",
    port: 0,
  });

  const bot = new Bot(TOKEN, {
    botInfo: BOT_INFO,
    client: { apiRoot: server.url.origin },
  });

  const bridge = await createBot(
    { botToken: TOKEN, orgId: null, profileId: "default" },
    {
      authStore,
      client: mock.client,
      getBotInfo: () => TEST_BOT_INFO,
      orgStore,
      sessionStore: new ChannelSessionStore(path.join(home, "sessions.json")),
    },
    bot
  );

  bot.catch((error) => {
    errors.push(error.error);
  });
  const runner = bridge.start();

  return {
    bot,
    errors,
    getPollCount: () => polls,
    getWebhookDeleteCount: () => webhookDeletes,
    mock,
    replies,
    runner,
    server,
  };
}

describe("Telegram polling", () => {
  test("polling clears an old webhook without dropping pending updates", async () => {
    await withPolling(
      [[message(1, 1, "first turn")]],
      async ({ getWebhookDeleteCount, mock }) => {
        await waitUntil(() => mock.calls.sendStream === 1);
        expect(getWebhookDeleteCount()).toBe(1);
      }
    );
  });

  test("a later poll delivers stop while the first turn is still running", async () => {
    await withPolling(
      [[message(1, 1, "long turn")], [message(2, 1, "/stop")]],
      async ({ mock, replies }) => {
        await waitUntil(
          () => mock.getStreamControl()?.signal?.aborted === true
        );
        expect(mock.calls.sendStream).toBe(1);
        await waitUntil(() => replies.includes(1));
      }
    );
  });

  test("another chat can run while the next turn in the first chat waits", async () => {
    await withPolling(
      [
        [message(1, 1, "first turn")],
        [message(2, 1, "queued turn"), message(3, 2, "other chat")],
      ],
      async ({ mock, replies }) => {
        await waitUntil(() => mock.calls.sendStream === 2);
        const [first, other] = mock.getStreamControls();
        other!.complete();
        await waitUntil(() => replies.includes(2));
        expect(replies).not.toContain(1);
        expect(mock.calls.sendStream).toBe(2);
        first!.complete();
        await waitUntil(() => mock.calls.sendStream === 3);
        mock.getStreamControl()!.complete();
      }
    );
  });

  test("a handler error is reported and does not stop another chat", async () => {
    await withPolling(
      [[message(1, 1, "first turn")], [message(2, 2, "other chat")]],
      async ({ errors, mock }) => {
        const failure = new Error("Profile lookup failed");

        const lookup = spyOn(mock.client, "listProfiles").mockRejectedValueOnce(
          failure
        );

        try {
          await waitUntil(() => errors.length > 0);
          expect(errors[0]).toBe(failure);
          await waitUntil(() => mock.calls.sendStream === 1);
        } finally {
          lookup.mockRestore();
        }
      }
    );
  });

  test("shutdown waits until an accepted turn finishes its reply", async () => {
    await withPolling(
      [[message(1, 1, "first turn")]],
      async ({ mock, replies, runner }) => {
        await waitUntil(() => mock.calls.sendStream === 1);
        let stopped = false;

        const stopping = runner.stop().then(() => {
          stopped = true;
        });

        await Bun.sleep(30);
        expect(stopped).toBe(false);
        mock.getStreamControl()!.complete();
        await stopping;
        expect(replies).toContain(1);
        expect(stopped).toBe(true);
      }
    );
  });

  test("shutdown also drains a turn waiting for the same chat", async () => {
    await withPolling(
      [[message(1, 1, "first turn")], [message(2, 1, "queued turn")]],
      async ({ getPollCount, mock, replies, runner }) => {
        await waitUntil(() => getPollCount() >= 3);
        let stopped = false;

        const stopping = runner.stop().then(() => {
          stopped = true;
        });

        mock.getStreamControl()!.complete();
        await waitUntil(() => mock.calls.sendStream === 2);
        expect(stopped).toBe(false);
        mock.getStreamControl()!.complete();
        await stopping;
        expect(replies).toEqual([1, 1]);
      }
    );
  });

  test("poll failures are reported without exposing the bot token", async () => {
    await withTempHome(async (home) => {
      const log = spyOn(console, "error").mockImplementation(() => {});
      const fixture = await pollingFixture(home, [], true);
      let failure: unknown;

      try {
        try {
          await fixture.runner.running;
        } catch (error) {
          failure = error;
        }

        expect(failure).toBeInstanceOf(Error);
        expect(inspect(failure)).not.toContain(TOKEN);
        expect(log.mock.calls.length).toBeGreaterThanOrEqual(2);
        expect(inspect(log.mock.calls)).not.toContain(TOKEN);
        expect(fixture.getPollCount()).toBe(2);
      } finally {
        await fixture.runner.stop();
        fixture.server.stop(true);
        log.mockRestore();
      }
    });
  });
});

test("concurrent chats send session requests to their own organizations", async () => {
  await withTempHome(async (home) => {
    await writeTelegramConfigIni(home, {
      allowedUserIds: [42, 43],
      botToken: TOKEN,
    });
    const authStore = new TelegramAuthStore(null);
    const orgStore = createTestOrgStore(home);
    await orgStore.load();
    orgStore.set("u:42", "org_a");
    orgStore.set("u:43", "org_b");
    await orgStore.save();
    const releaseFirst = Promise.withResolvers<void>();
    let firstProfilesRequested = false;
    const sessions: Array<{ org: string | null; profile: string }> = [];

    const client = new NakamaClient({
      baseUrl: "http://nakama.test",
      fetch: async (input, options) => {
        const pathname = new URL(String(input)).pathname;
        const org = new Headers(options?.headers).get("X-Org-Id");

        if (pathname === "/v1/auth/orgs") {
          return Response.json({ orgs: createMultiTestOrgs() });
        }

        if (pathname === "/v1/profiles") {
          if (org === "org_a") {
            firstProfilesRequested = true;
            await releaseFirst.promise;
          }

          return Response.json({
            profiles: [
              {
                id: `profile_${org}`,
                isDefault: true,
                isSuper: false,
                model: null,
                name: "Default",
              },
            ],
          });
        }

        if (pathname === "/v1/sessions") {
          const body = JSON.parse(String(options?.body));
          sessions.push({ org, profile: body.profileId });
          releaseFirst.resolve();

          return Response.json({ sessionId: `session_${org}` });
        }

        if (pathname.endsWith("/messages")) {
          if (options?.method !== "POST") {
            return Response.json({
              channel: "telegram",
              messages: [],
              model: null,
            });
          }

          return new Response('data: {"type":"done","reply":"Reply"}\n\n', {
            headers: { "Content-Type": "text/event-stream" },
          });
        }

        throw new Error(`Unexpected request: ${pathname}`);
      },
    });

    const handler = createChatHandler({
      authStore,
      client,
      config: { botToken: TOKEN, orgId: null, profileId: "default" },
      orgStore,
      sessionStore: new ChannelSessionStore(path.join(home, "sessions.json")),
    });

    const first = handler(
      createMessageContext({ text: "First org", userId: 42 }).ctx
    );

    try {
      await waitUntil(() => firstProfilesRequested);
      await handler(
        createMessageContext({ text: "Second org", userId: 43 }).ctx
      );
      await first;
      expect(sessions).toContainEqual({
        org: "org_a",
        profile: "profile_org_a",
      });
      expect(sessions).toContainEqual({
        org: "org_b",
        profile: "profile_org_b",
      });
    } finally {
      releaseFirst.resolve();
      await first;
    }
  });
});

test("a full same-chat queue still lets stop and another chat through polling", async () => {
  await withPolling(
    [
      [message(1, 1, "long turn")],
      Array.from({ length: 19 }, (_, index) =>
        message(index + 2, 1, "queued turn")
      ),
      [message(21, 2, "another chat"), message(22, 1, "/stop")],
    ],
    async ({ mock, replies }) => {
      await waitUntil(
        () => mock.getStreamControls()[0]?.signal?.aborted === true
      );
      await waitUntil(() => mock.calls.sendStream === 3);

      for (const turn of mock.getStreamControls()) {
        turn.complete();
      }

      await waitUntil(() => replies.includes(2));
      expect(mock.getStreamControls()[0]?.signal?.aborted).toBe(true);
    }
  );
});

test("a startup burst cannot start more than twenty turns", async () => {
  await withPolling(
    [
      Array.from({ length: 25 }, (_, index) =>
        message(index + 1, index + 1, "long turn")
      ),
    ],
    async ({ mock, replies }) => {
      await waitUntil(
        () => replies.length === 5 && mock.calls.sendStream === 20
      );
      expect(mock.calls.sendStream).toBe(20);
      expect(replies.every((chat) => chat > 20)).toBe(true);
    }
  );
});

test("overload preserves the group and authorization checks", async () => {
  const group = message(21, -100, "an unrelated group message");
  const stranger = message(22, 99, "unpaired user");
  stranger.message.from.id = 99;
  await withPolling(
    [
      Array.from({ length: 20 }, (_, index) =>
        message(index + 1, index + 1, "long turn")
      ),
      [
        {
          ...group,
          message: {
            ...group.message,
            chat: { id: -100, title: "Group", type: "supergroup" },
          },
        },
        stranger,
      ],
    ],
    async ({ getPollCount, mock, replies, runner }) => {
      await waitUntil(
        () => getPollCount() >= 3 && mock.calls.sendStream === 20
      );
      const stopping = runner.stop();

      for (const turn of mock.getStreamControls()) {
        turn.complete();
      }

      await stopping;
      expect(replies).not.toContain(-100);
      expect(replies).not.toContain(99);
      expect(mock.calls.sendStream).toBe(20);
    }
  );
});
