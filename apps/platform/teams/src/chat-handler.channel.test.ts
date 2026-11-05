import { describe, expect, test } from "bun:test";
import { withTempHome } from "@nakama/core/channel-test-helpers";
import { ALLOWED, activity, CONFIG, createHarness } from "./test-helpers";

describe("teams chat handler in a channel thread", () => {
  const THREAD_A = "19:general@thread.tacv2;messageid=1001";
  const THREAD_B = "19:general@thread.tacv2;messageid=2002";

  function mention(patch: Partial<Parameters<typeof activity>[0]> = {}) {
    return activity({
      conversationId: THREAD_A,
      conversationType: "channel",
      mentionsBot: true,
      ...patch,
    });
  }

  test("a mention in a channel thread gets the reply in that thread", async () => {
    await withTempHome("nakama-teams-handler-", async (homeDir) => {
      const { handle, replies, turns } = createHarness(homeDir);

      await handle(mention({ text: " what is nakama" }));
      await handle(activity({ text: "what is nakama" }));

      // The channel turn carries more than the text, so the agent can be told
      // its answer is public; the personal turn is the text alone.
      const [channelTurn, personalTurn] = turns.map((turn) => turn.message);

      expect(channelTurn?.endsWith("\nwhat is nakama")).toBe(true);
      expect(channelTurn).not.toBe("what is nakama");
      expect(personalTurn).toBe("what is nakama");
      expect(replies.map((entry) => entry.conversationId)).toEqual([
        THREAD_A,
        "conv_1",
      ]);
    });
  });

  test("each channel thread keeps its own session", async () => {
    await withTempHome("nakama-teams-handler-", async (homeDir) => {
      const { createdSessions, handle, turns } = createHarness(homeDir);

      await handle(mention({ conversationId: THREAD_A }));
      await handle(mention({ conversationId: THREAD_B }));
      await handle(mention({ conversationId: THREAD_A }));

      expect(createdSessions).toEqual(["session_1", "session_2"]);
      expect(turns.map((turn) => turn.sessionId)).toEqual([
        "session_1",
        "session_2",
        "session_1",
      ]);
    });
  });

  test("each sender in a thread keeps their own session", async () => {
    await withTempHome("nakama-teams-handler-", async (homeDir) => {
      const other = "55555555-5555-4555-8555-555555555555";

      const { createdSessions, handle, turns } = createHarness(homeDir, {
        config: { ...CONFIG, allowedUserIds: [ALLOWED, other] },
      });

      await handle(mention());
      await handle(mention({ senderId: other }));
      await handle(mention());

      expect(createdSessions).toEqual(["session_1", "session_2"]);
      expect(turns.map((turn) => turn.sessionId)).toEqual([
        "session_1",
        "session_2",
        "session_1",
      ]);
    });
  });

  test("only the newest thread sessions are kept", async () => {
    await withTempHome("nakama-teams-handler-", async (homeDir) => {
      const { handle, sessionStore } = createHarness(homeDir);

      await handle(activity({ conversationId: "conv_personal" }));

      for (let index = 0; index < 501; index += 1) {
        await handle(
          mention({
            conversationId: `19:general@thread.tacv2;messageid=${index}`,
          })
        );
      }

      const key = (index: number) =>
        `teams-thread:19:general@thread.tacv2;messageid=${index}:${ALLOWED}`;

      expect(sessionStore.get(key(0))).toBeUndefined();
      expect(sessionStore.get(key(1))).toBeDefined();
      expect(sessionStore.get(key(500))).toBeDefined();
      expect(sessionStore.get("teams:conv_personal")).toBeDefined();
    });
  });

  test("a thread in use is kept over one made later", async () => {
    await withTempHome("nakama-teams-handler-", async (homeDir) => {
      const { handle, sessionStore } = createHarness(homeDir);

      const thread = (index: number) =>
        `19:general@thread.tacv2;messageid=${index}`;

      await handle(mention({ conversationId: thread(0) }));

      for (let index = 1; index < 500; index += 1) {
        await handle(mention({ conversationId: thread(index) }));
      }

      // Thread 0 is the oldest made, but it is used again before the cap.
      await Bun.sleep(5);
      await handle(mention({ conversationId: thread(0) }));
      await handle(mention({ conversationId: thread(500) }));

      const key = (index: number) => `teams-thread:${thread(index)}:${ALLOWED}`;

      expect(sessionStore.get(key(0))).toBeDefined();
      expect(sessionStore.get(key(1))).toBeUndefined();
      expect(sessionStore.get(key(500))).toBeDefined();
    });
  });

  test("a bare mention says how to start and runs no turn", async () => {
    await withTempHome("nakama-teams-handler-", async (homeDir) => {
      const { handle, replies, turns } = createHarness(homeDir);

      await handle(mention({ text: "" }));

      expect(turns).toEqual([]);
      expect(replies.map((entry) => entry.conversationId)).toEqual([THREAD_A]);
    });
  });

  test("!status in a channel shows nothing about the agent", async () => {
    await withTempHome("nakama-teams-handler-", async (homeDir) => {
      let healthChecks = 0;

      const { handle, replies } = createHarness(homeDir, {
        health: async () => {
          healthChecks += 1;

          return { ok: true, providerConfigured: true };
        },
      });

      await handle(mention({ text: "!status" }));

      expect(healthChecks).toBe(0);
      expect(replies.map((entry) => entry.conversationId)).toEqual([THREAD_A]);

      await handle(activity({ text: "!status" }));
      expect(healthChecks).toBe(1);
    });
  });

  test("a channel mention delivered twice is answered once", async () => {
    await withTempHome("nakama-teams-handler-", async (homeDir) => {
      const { handle, replies, turns } = createHarness(homeDir);
      const duplicate = mention({ text: "only once" });

      await Promise.all([handle(duplicate), handle(duplicate)]);

      expect(turns).toHaveLength(1);
      expect(replies).toHaveLength(1);
    });
  });

  test("an unlinked sender's channel mention is told to pair in a personal chat", async () => {
    await withTempHome("nakama-teams-handler-", async (homeDir) => {
      const { handle, replies, turns } = createHarness(homeDir);

      await handle(
        mention({ senderId: "99999999-9999-4999-8999-999999999999" })
      );

      expect(turns).toEqual([]);
      expect(replies.map((entry) => entry.conversationId)).toEqual([THREAD_A]);
    });
  });
});
