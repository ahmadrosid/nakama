import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { NakamaClient } from "@nakama/client";
import { ChannelSessionStore } from "@nakama/core/channel-session-store";
import {
  createDefaultTestOrgs,
  withTempHome,
} from "@nakama/core/channel-test-helpers";
import type { TeamsConfigFile } from "@nakama/core/teams-config";
import { createTeamsChatHandler, type TeamsActivity } from "./chat-handler";

const ORG = "org_test";

const OWNER = { orgId: ORG, profileId: "default" };

const TENANT = "33333333-3333-4333-8333-333333333333";

const ALLOWED = "11111111-1111-4111-8111-111111111111";

const CONFIG: TeamsConfigFile = {
  allowedUserIds: [ALLOWED],
  clientId: "22222222-2222-4222-8222-222222222222",
  clientSecret: "secret",
  inboundPort: 4321,
  profileId: "default",
  tenantId: TENANT,
};

function activity(patch: Partial<TeamsActivity> = {}): TeamsActivity {
  return {
    conversationId: "conv_1",
    conversationType: "personal",
    id: `act_${Math.random().toString(16).slice(2)}`,
    isBot: false,
    senderId: ALLOWED,
    tenantId: TENANT,
    text: "hello",
    ...patch,
  };
}

function createHarness(
  homeDir: string,
  options: {
    config?: TeamsConfigFile | null;
    loadConfig?: () => Promise<TeamsConfigFile | null>;
    onSend?: (message: string) => Promise<string>;
  } = {}
) {
  const turns: { message: string; sessionId: string }[] = [];
  const replies: { conversationId: string; text: string }[] = [];
  const createdSessions: string[] = [];
  let nextSession = 0;

  const makeSession = (sessionId: string) => ({
    clear: async () => {},
    getMessages: async () => [],
    id: sessionId,
    send: async (input: { message: string }) => {
      turns.push({ message: input.message, sessionId });

      return options.onSend
        ? await options.onSend(input.message)
        : `echo: ${input.message}`;
    },
  });

  // SAFETY: The handler calls only these client methods, and the fake answers
  // each one the way the real client does.
  const client = {
    createChatSession: (sessionId: string) => makeSession(sessionId),
    createSession: async () => {
      nextSession += 1;
      const id = `session_${nextSession}`;

      createdSessions.push(id);

      return makeSession(id);
    },
    forOrg: () => client,
    listProfiles: async () => ({ profiles: [{ id: "default" }] }),
    listUserOrgs: async () => ({ orgs: createDefaultTestOrgs() }),
  } as NakamaClient;

  const sessionStore = new ChannelSessionStore(
    join(
      homeDir,
      ".nakama",
      "orgs",
      ORG,
      "channels",
      "default",
      "teams",
      "chat-sessions.json"
    )
  );

  const handle = createTeamsChatHandler({
    client,
    loadConfig:
      options.loadConfig ??
      (async () => (options.config === undefined ? CONFIG : options.config)),
    owner: OWNER,
    send: async (conversationId, text) => {
      replies.push({ conversationId, text });
    },
    sessionStore,
  });

  return { createdSessions, handle, replies, sessionStore, turns };
}

describe("teams chat handler", () => {
  test("an allowed user in a personal chat gets the agent's reply", async () => {
    await withTempHome("nakama-teams-handler-", async (homeDir) => {
      const { handle, replies, turns } = createHarness(homeDir);

      await handle(activity({ text: "what is nakama" }));

      expect(turns).toEqual([
        { message: "what is nakama", sessionId: "session_1" },
      ]);
      expect(replies).toEqual([
        { conversationId: "conv_1", text: "echo: what is nakama" },
      ]);
    });
  });

  test("each personal chat keeps its own session", async () => {
    await withTempHome("nakama-teams-handler-", async (homeDir) => {
      const { createdSessions, handle, turns } = createHarness(homeDir);

      await handle(activity({ conversationId: "conv_a" }));
      await handle(activity({ conversationId: "conv_b" }));
      await handle(activity({ conversationId: "conv_a" }));

      expect(createdSessions).toEqual(["session_1", "session_2"]);
      expect(turns.map((turn) => turn.sessionId)).toEqual([
        "session_1",
        "session_2",
        "session_1",
      ]);
    });
  });

  for (const [name, patch] of [
    ["a bot", { isBot: true }],
    ["another tenant", { tenantId: "44444444-4444-4444-8444-444444444444" }],
    [
      "a user outside the allowlist",
      { senderId: "99999999-9999-4999-8999-999999999999" },
    ],
    ["a group conversation", { conversationType: "groupChat" }],
    ["an empty message", { text: "   " }],
  ] as const) {
    test(`${name} never reaches the agent`, async () => {
      await withTempHome("nakama-teams-handler-", async (homeDir) => {
        const { handle, replies, turns } = createHarness(homeDir);

        await handle(activity(patch));

        expect(turns).toEqual([]);
        expect(replies).toEqual([]);
      });
    });
  }

  test("no configuration means no agent call", async () => {
    await withTempHome("nakama-teams-handler-", async (homeDir) => {
      const { handle, turns } = createHarness(homeDir, { config: null });

      await handle(activity());

      expect(turns).toEqual([]);
    });
  });

  test("access removed while a turn waits stops the queued turn", async () => {
    await withTempHome("nakama-teams-handler-", async (homeDir) => {
      let allowed = true;

      const { handle, turns } = createHarness(homeDir, {
        loadConfig: async () =>
          allowed ? CONFIG : { ...CONFIG, allowedUserIds: [] },
        onSend: async (message) => {
          // The first turn is still running when the admin revokes access.
          allowed = false;

          return `echo: ${message}`;
        },
      });

      await handle(activity({ text: "first" }));
      await handle(activity({ text: "second" }));

      expect(turns.map((turn) => turn.message)).toEqual(["first"]);
    });
  });

  // The second turn passes the first check, then waits for the lock. Access is
  // removed while it waits, so only the re-read inside the lock can stop it.
  test("access removed while a turn is queued stops it at the lock", async () => {
    await withTempHome("nakama-teams-handler-", async (homeDir) => {
      let configReads = 0;
      let releaseFirst = () => {};

      const firstRunning = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });

      const { handle, turns } = createHarness(homeDir, {
        loadConfig: async () => {
          configReads += 1;

          // Both pre-lock reads and the first turn's re-read still allow it.
          return configReads <= 3 ? CONFIG : { ...CONFIG, allowedUserIds: [] };
        },
        onSend: async (message) => {
          if (message === "first") {
            await firstRunning;
          }

          return `echo: ${message}`;
        },
      });

      const first = handle(activity({ text: "first" }));
      const second = handle(activity({ text: "second" }));

      releaseFirst();
      await Promise.all([first, second]);

      expect(turns.map((turn) => turn.message)).toEqual(["first"]);
    });
  });

  test("the same activity delivered twice runs one turn", async () => {
    await withTempHome("nakama-teams-handler-", async (homeDir) => {
      const { handle, turns } = createHarness(homeDir);
      const duplicate = activity({ text: "only once" });

      await Promise.all([handle(duplicate), handle(duplicate)]);

      expect(turns).toHaveLength(1);
    });
  });

  test("a saved session is reused after a restart", async () => {
    await withTempHome("nakama-teams-handler-", async (homeDir) => {
      const first = createHarness(homeDir);

      await first.handle(activity({ conversationId: "conv_restart" }));
      await first.sessionStore.save();

      const second = createHarness(homeDir);

      await second.sessionStore.load();
      await second.handle(activity({ conversationId: "conv_restart" }));

      expect(second.createdSessions).toEqual([]);
      expect(second.turns[0]?.sessionId).toBe("session_1");
    });
  });
});
