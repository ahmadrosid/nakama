import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { NakamaClient } from "@nakama/client";
import { ChannelSessionStore } from "@nakama/core/channel-session-store";
import {
  createDefaultTestOrgs,
  withTempHome,
} from "@nakama/core/channel-test-helpers";
import {
  loadSlackConfigFile,
  regenerateSlackHandshake,
  type SlackMember,
  saveSlackConfig,
} from "@nakama/core/slack-config";
import {
  createChatHandler,
  normalizeSlackText,
  type SlackApi,
} from "./chat-handler";
import type { SlackMessageEvent } from "./socket";

const BOT = "UBOT0001";
const OWNER = "UOWNER01";

type Posted = { channel: string; text: string; threadTs?: string };

const TEAM = "T0HOME01";
const ORG = "org_test";
const OWNER_AGENT = { orgId: ORG, profileId: "default" };

type StreamHandlers = {
  onChunk: (delta: string) => void;
  onToolStart?: () => void;
};
type FakeStream = (
  handlers: StreamHandlers,
  signal: AbortSignal
) => Promise<string>;

function createHarness(
  homeDir: string,
  orgs = createDefaultTestOrgs(),
  members: Record<string, SlackMember> = {},
  options: { postDelayMs?: (text: string) => number; stream?: FakeStream } = {}
) {
  const posted: Posted[] = [];
  const turns: string[] = [];
  const orgRequests: Array<string | null> = [];
  const slack: SlackApi = {
    addReaction: async () => {},
    getMember: async (userId) => {
      const member = members[userId];
      if (!member) {
        throw new Error("Slack users.info failed: user_not_found");
      }
      return member;
    },
    postMessage: async (channel, text, threadTs) => {
      await Bun.sleep(options.postDelayMs?.(text) ?? 0);
      posted.push({ channel, text, threadTs });
    },
    removeReaction: async () => {},
  };
  let sessionCount = 0;
  const createSession = () => {
    sessionCount += 1;
    const id = `session_${sessionCount}`;
    return {
      clear: async () => {},
      getMessages: async () => [],
      id,
      sendStream: async (
        input: { message: string },
        handlers: StreamHandlers,
        streamOptions?: { signal?: AbortSignal }
      ) => {
        turns.push(input.message);
        if (options.stream && streamOptions?.signal) {
          return options.stream(handlers, streamOptions.signal);
        }
        handlers.onChunk(`reply from ${id}`);
        return `reply from ${id}`;
      },
    };
  };
  const client = {
    createChatSession: () => createSession(),
    createSession: async () => createSession(),
    forOrg: (orgId: string | null) => {
      orgRequests.push(orgId);
      return client;
    },
    health: async () => ({ ok: true, providerConfigured: true }),
    listProfiles: async () => ({
      profiles: [{ id: "default", isDefault: true, name: "Default" }],
    }),
    listUserOrgs: async () => ({ orgs }),
    setOrgId: () => {},
  } as unknown as NakamaClient;
  const sessionStore = new ChannelSessionStore(
    join(
      homeDir,
      ".nakama",
      "orgs",
      ORG,
      "channels",
      "default",
      "slack",
      "chat-sessions.json"
    )
  );
  const handle = createChatHandler({
    botTeamId: TEAM,
    botUserId: BOT,
    client,
    owner: OWNER_AGENT,
    sessionStore,
    slack,
  });

  return { handle, orgRequests, posted, sessionStore, turns };
}

function message(
  fields: Partial<SlackMessageEvent> & { text: string }
): SlackMessageEvent {
  return {
    channel: "C0CHANNEL",
    channel_type: "channel",
    ts: "100.000",
    type: "message",
    user: OWNER,
    ...fields,
  };
}

async function saveTokens(allowedUserIds = "") {
  await saveSlackConfig(OWNER_AGENT, {
    allowedUserIds,
    appToken: "xapp-1-test",
    botToken: "xoxb-test",
  });
}

describe("slack chat handler", () => {
  test("pairs a DM sender with the dashboard code, then answers them", async () => {
    await withTempHome("nakama-slack-pair-", async (homeDir) => {
      await saveTokens();
      const { handshakeCode } = await regenerateSlackHandshake(OWNER_AGENT);
      const { handle, posted, turns } = createHarness(homeDir);
      const dm = { channel: "D0DIRECT", channel_type: "im" };

      await handle(message({ ...dm, text: "hello" }));
      expect(turns).toHaveLength(0);

      await handle(message({ ...dm, text: handshakeCode!.toLowerCase() }));
      expect((await loadSlackConfigFile(OWNER_AGENT))?.pairedUserIds).toEqual([
        OWNER,
      ]);

      await handle(message({ ...dm, text: "hello again" }));
      expect(turns).toEqual(["hello again"]);
      expect(posted.at(-1)).toEqual({
        channel: "D0DIRECT",
        text: "reply from session_1",
        threadTs: undefined,
      });
    });
  });

  test("answers a channel mention in a thread and follows only that thread", async () => {
    await withTempHome("nakama-slack-thread-", async (homeDir) => {
      await saveTokens(OWNER);
      const { handle, posted, turns } = createHarness(homeDir);

      await handle(message({ text: "no mention here" }));
      expect(turns).toHaveLength(0);

      await handle(message({ text: `<@${BOT}> summarize this` }));
      expect(turns).toHaveLength(1);
      expect(turns[0]).toEndWith("summarize this");
      expect(posted.at(-1)?.threadTs).toBe("100.000");

      await handle(
        message({ text: "and more", thread_ts: "100.000", ts: "101" })
      );
      expect(turns).toHaveLength(2);
      expect(posted.at(-1)?.text).toBe("reply from session_1");

      await handle(
        message({ text: "other thread", thread_ts: "200.000", ts: "201" })
      );
      expect(turns).toHaveLength(2);
    });
  });

  test("ignores strangers in channels and bot or edited messages", async () => {
    await withTempHome("nakama-slack-ignore-", async (homeDir) => {
      await saveTokens(OWNER);
      const { handle, posted, turns } = createHarness(homeDir);

      await handle(message({ text: `<@${BOT}> hi`, user: BOT }));
      await handle(message({ bot_id: "B1", text: `<@${BOT}> hi` }));
      await handle(
        message({ subtype: "message_changed", text: `<@${BOT}> hi` })
      );

      expect(turns).toHaveLength(0);
      expect(posted).toHaveLength(0);
    });
  });

  test("routes ! commands instead of starting a turn", async () => {
    await withTempHome("nakama-slack-commands-", async (homeDir) => {
      await saveTokens(OWNER);
      const { handle, posted, turns } = createHarness(homeDir);
      const dm = { channel: "D0DIRECT", channel_type: "im" };

      await handle(message({ ...dm, text: "!stop" }));
      await handle(message({ ...dm, text: "!new" }));

      expect(turns).toHaveLength(0);
      expect(posted.map((entry) => entry.text)).toEqual([
        "Nothing to stop.",
        "Started a new conversation.",
      ]);
    });
  });
});

test("tells an unlinked member who mentions the bot in a channel to pair in a DM", async () => {
  await withTempHome("nakama-slack-stranger-", async (homeDir) => {
    await saveTokens(OWNER);
    const { handshakeCode } = await regenerateSlackHandshake(OWNER_AGENT);
    const { handle, posted, turns } = createHarness(homeDir);

    await handle(
      message({ text: `<@${BOT}> ${handshakeCode}`, user: "USTRANGER" })
    );
    await handle(
      message({ text: "no mention", thread_ts: "100.000", user: "USTRANGER" })
    );

    expect(turns).toHaveLength(0);
    expect(posted).toHaveLength(1);
    expect(posted[0]?.threadTs).toBe("100.000");
    expect(posted[0]?.text).toContain("Messages tab");
    // The code was not consumed in public.
    expect((await loadSlackConfigFile(OWNER_AGENT))?.pairedUserIds).toEqual([]);
  });
});

test("every chat runs as the agent that owns the connection, and !org or !profile cannot move it", async () => {
  await withTempHome("nakama-slack-org-", async (homeDir) => {
    await saveTokens(OWNER);
    const { handle, orgRequests, posted, turns } = createHarness(homeDir);
    const dm = { channel: "D0DIRECT", channel_type: "im" };

    await handle(message({ ...dm, text: "hello" }));
    await handle(message({ ...dm, text: "!org beta" }));
    await handle(message({ ...dm, text: "!profile other" }));

    expect(turns).toEqual(["hello"]);
    expect(orgRequests).toEqual([ORG]);
    expect(posted.slice(-2).map((entry) => entry.text)).toEqual([
      "This connection belongs to agent default.",
      "This connection belongs to agent default.",
    ]);
  });
});

test("a session saved for another agent is never continued", async () => {
  await withTempHome("nakama-slack-owner-session-", async (homeDir) => {
    await saveTokens(OWNER);
    const { handle, sessionStore } = createHarness(homeDir);
    sessionStore.set("D0DIRECT", {
      profileId: "someone-else",
      sessionId: "old-session",
      updatedAt: new Date().toISOString(),
    });

    await handle(
      message({ channel: "D0DIRECT", channel_type: "im", text: "hi" })
    );

    expect(sessionStore.get("D0DIRECT")).toMatchObject({
      profileId: "default",
      sessionId: "session_1",
    });
  });
});

test("everyone in the workspace can chat, but guests and outsiders cannot", async () => {
  await withTempHome("nakama-slack-workspace-", async (homeDir) => {
    await saveSlackConfig(OWNER_AGENT, {
      allowWorkspace: true,
      appToken: "xapp-1-test",
      botToken: "xoxb-test",
    });
    const { handle, turns } = createHarness(homeDir, undefined, {
      UGUEST001: { is_restricted: true, team_id: TEAM },
      UMEMBER01: { team_id: TEAM },
      UOUTSIDE1: { team_id: "T0OTHER1" },
    });
    const mention = (user: string, ts: string) =>
      handle(message({ text: `<@${BOT}> hi`, ts, user }));

    await mention("UMEMBER01", "1.0");
    await mention("UGUEST001", "2.0");
    await mention("UOUTSIDE1", "3.0");
    await mention("UUNKNOWN1", "4.0");

    expect(turns).toHaveLength(1);
  });
});

test("the workspace gate stays shut until it is turned on", async () => {
  await withTempHome("nakama-slack-workspace-off-", async (homeDir) => {
    await saveTokens();
    const { handle, turns } = createHarness(homeDir, undefined, {
      UMEMBER01: { team_id: TEAM },
    });

    await handle(message({ text: `<@${BOT}> hi`, user: "UMEMBER01" }));

    expect(turns).toHaveLength(0);
  });
});

test("!new stops a reply that is still streaming instead of waiting behind it", async () => {
  await withTempHome("nakama-slack-new-", async (homeDir) => {
    await saveTokens(OWNER);
    // A turn that only ends when it is aborted, like a long tool run. It
    // reports when it starts, so the test never races the handler's setup.
    let markStarted = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const hang: FakeStream = (_handlers, signal) =>
      new Promise((_resolve, reject) => {
        markStarted();
        signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    const { handle, posted } = createHarness(
      homeDir,
      undefined,
      {},
      {
        stream: hang,
      }
    );
    const dm = { channel: "D0NEWCMD", channel_type: "im" };

    const running = handle(message({ ...dm, text: "long job" }));
    await started;
    await handle(message({ ...dm, text: "!new", ts: "101" }));
    await running;

    expect(posted.map((entry) => entry.text)).toEqual([
      "Stopped.",
      "Started a new conversation.",
    ]);
  });
});

test("text written before each tool call is posted in order", async () => {
  await withTempHome("nakama-slack-order-", async (homeDir) => {
    await saveTokens(OWNER);
    const stream: FakeStream = async (handlers) => {
      handlers.onChunk("first");
      handlers.onToolStart?.();
      handlers.onChunk("second");
      handlers.onToolStart?.();
      handlers.onChunk("done");
      return "firstseconddone";
    };
    // The first post is the slowest, so parallel posts would land reversed.
    const { handle, posted } = createHarness(
      homeDir,
      undefined,
      {},
      {
        postDelayMs: (text) => (text === "first" ? 30 : 0),
        stream,
      }
    );

    await handle(
      message({ channel: "D0ORDER1", channel_type: "im", text: "go" })
    );

    expect(posted.map((entry) => entry.text)).toEqual([
      "first",
      "second",
      "done",
    ]);
  });
});

describe("normalizeSlackText", () => {
  test("drops the bot mention and unescapes links and entities", () => {
    expect(
      normalizeSlackText(
        `<@${BOT}> see <https://example.com|docs> &amp; <https://a.b> 1 &lt; 2`,
        BOT
      )
    ).toBe("see docs (https://example.com) & https://a.b 1 < 2");
  });
});
