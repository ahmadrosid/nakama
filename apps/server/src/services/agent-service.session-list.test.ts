import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { setupTestConfigDir } from "../test-config-dir";
import { AgentService } from "./agent-service";
import { createDefaultProfile } from "./agent-service-test-fixtures";
import { sessionTurnRegistry } from "./session-turn-registry";

const ORG_ID = "org_test";

async function createService(): Promise<{
  db: ReturnType<typeof createInMemoryDatabaseAdapter>;
  service: AgentService;
}> {
  const db = createInMemoryDatabaseAdapter();
  await db.upsertProfile(createDefaultProfile());
  return { db, service: new AgentService(null, null, db) };
}

/** The list only carries sessions that hold a message, so seed one. */
async function seedFirstMessage(
  db: ReturnType<typeof createInMemoryDatabaseAdapter>,
  sessionId: string
): Promise<void> {
  await db.appendMessagesForSession(sessionId, [
    {
      createdAt: new Date().toISOString(),
      id: `msg_${sessionId}`,
      payload: { content: "hello", role: "user" },
      seq: 0,
      sessionId,
    },
  ]);
}

describe("listSessions reports the live turn", () => {
  setupTestConfigDir("nakama-session-list-");

  test("a session is active only while its turn is running", async () => {
    const { db, service } = await createService();
    const sessionId = await service.createSession(
      ORG_ID,
      "web",
      "profile_default",
      null
    );
    await seedFirstMessage(db, sessionId);

    const idle = await service.listSessions(ORG_ID, "profile_default", "web", {
      isPlatformAdmin: true,
    });
    expect(idle.sessions.map((session) => session.active)).toEqual([false]);

    expect(sessionTurnRegistry.beginTurn(sessionId).started).toBe(true);
    try {
      const running = await service.listSessions(
        ORG_ID,
        "profile_default",
        "web",
        { isPlatformAdmin: true }
      );
      expect(running.sessions.map((session) => session.active)).toEqual([true]);
    } finally {
      sessionTurnRegistry.endTurn(sessionId, { reply: "ok", type: "done" });
    }

    // The sidebar mark has to clear on its own once the turn ends, without the
    // list being invalidated by whoever was watching the stream.
    const settled = await service.listSessions(
      ORG_ID,
      "profile_default",
      "web",
      { isPlatformAdmin: true }
    );
    expect(settled.sessions.map((session) => session.active)).toEqual([false]);
  });
});

describe("listSessions pages the merged history", () => {
  setupTestConfigDir("nakama-session-page-");
  const ACCESS = { isPlatformAdmin: true };
  const CHANNELS = ["web", "telegram", "discord"] as const;

  async function seedHistory() {
    const { db, service } = await createService();
    const ids: string[] = [];
    for (const channel of [
      "web",
      "telegram",
      "web",
      "discord",
      "web",
    ] as const) {
      const id = await service.createSession(
        ORG_ID,
        channel,
        "profile_default",
        null
      );
      await seedFirstMessage(db, id);
      ids.push(id);
    }
    // Pinned sorts first, so the cursor has to carry it across pages too.
    await service.updateSessionPinned(ids[0] as string, ORG_ID, true);
    return { db, ids, service };
  }

  test("following nextCursor returns every session once, in list order", async () => {
    const { service } = await seedHistory();
    const all = await service.listSessions(
      ORG_ID,
      "profile_default",
      CHANNELS,
      ACCESS
    );
    expect(all.nextCursor).toBeUndefined();
    expect(all.sessions).toHaveLength(5);

    const paged: string[] = [];
    const sizes: number[] = [];
    let cursor: string | undefined;
    do {
      const page = await service.listSessions(
        ORG_ID,
        "profile_default",
        CHANNELS,
        ACCESS,
        undefined,
        { cursor, limit: 2 }
      );
      paged.push(...page.sessions.map((session) => session.id));
      sizes.push(page.sessions.length);
      expect(page.stale).toBe(false);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    expect(sizes).toEqual([2, 2, 1]);
    expect(paged).toEqual(all.sessions.map((session) => session.id));
  });

  test("a page asked for after a chat moved across its cursor is stale", async () => {
    const { db, service } = await seedHistory();
    const listPage = (cursor?: string) =>
      service.listSessions(
        ORG_ID,
        "profile_default",
        CHANNELS,
        ACCESS,
        undefined,
        { cursor, limit: 2 }
      );
    const first = await listPage();
    const all = await service.listSessions(
      ORG_ID,
      "profile_default",
      CHANNELS,
      ACCESS
    );
    // The oldest chat gets a new message, which lifts it above the cursor
    // before the second page is asked for.
    const oldest = all.sessions.at(-1)?.id as string;
    await db.appendMessagesForSession(oldest, [
      {
        createdAt: new Date(Date.now() + 60_000).toISOString(),
        id: `msg_${oldest}_later`,
        payload: { content: "later", role: "user" },
        seq: 1,
        sessionId: oldest,
      },
    ]);

    const second = await listPage(first.nextCursor ?? undefined);
    expect(second.stale).toBe(true);
    expect(second.sessions.map((session) => session.id)).not.toContain(oldest);
  });

  test("a page that ends exactly at the last session has no next page", async () => {
    const { service } = await seedHistory();
    const page = await service.listSessions(
      ORG_ID,
      "profile_default",
      CHANNELS,
      ACCESS,
      undefined,
      { limit: 5 }
    );
    expect(page.sessions).toHaveLength(5);
    expect(page.nextCursor).toBeNull();
  });

  test("a cursor that is not ours is a 400", async () => {
    const { service } = await seedHistory();
    await expect(
      service.listSessions(
        ORG_ID,
        "profile_default",
        CHANNELS,
        ACCESS,
        undefined,
        { cursor: "not-a-cursor", limit: 2 }
      )
    ).rejects.toMatchObject({ status: 400 });
  });

  test("getSessionSummary finds one session and misses an unknown one", async () => {
    const { ids, service } = await seedHistory();
    const telegramId = ids[1] as string;
    const summary = await service.getSessionSummary(telegramId, ORG_ID);
    expect(summary).toMatchObject({ channel: "telegram", id: telegramId });
    expect(await service.getSessionSummary("missing", ORG_ID)).toBeNull();
  });
});

describe("listSessions searches titles and message text", () => {
  setupTestConfigDir("nakama-session-search-");
  const ACCESS = { isPlatformAdmin: true };
  const CHANNELS = ["web", "telegram"] as const;

  async function seedChat(
    db: ReturnType<typeof createInMemoryDatabaseAdapter>,
    service: AgentService,
    channel: "web" | "telegram",
    messages: Array<{ content: unknown; role: string }>,
    title?: string
  ): Promise<string> {
    const id = await service.createSession(
      ORG_ID,
      channel,
      "profile_default",
      null
    );
    await db.appendMessagesForSession(
      id,
      messages.map((payload, seq) => ({
        createdAt: new Date().toISOString(),
        id: `msg_${id}_${seq}`,
        payload: payload as never,
        seq,
        sessionId: id,
      }))
    );
    if (title) {
      await db.renameSessionTitle(id, title);
    }
    return id;
  }

  async function seedSearchable() {
    const { db, service } = await createService();
    const ids = {
      array: await seedChat(db, service, "telegram", [
        { content: "hi", role: "user" },
        {
          content: [{ text: "The 100% total is ready", type: "text" }],
          role: "assistant",
        },
      ]),
      invoice: await seedChat(db, service, "web", [
        { content: "Where is the invoice for March?", role: "user" },
      ]),
      snake: await seedChat(db, service, "web", [
        { content: "rename 100x files to snake_case", role: "user" },
      ]),
      title: await seedChat(
        db,
        service,
        "web",
        [{ content: "hello", role: "user" }],
        "Budget plan"
      ),
      tool: await seedChat(db, service, "web", [
        { content: "run it", role: "user" },
        { content: "invoice 100x in the tool output", role: "tool" },
      ]),
    };
    const search = async (query: string) =>
      (
        await service.listSessions(
          ORG_ID,
          "profile_default",
          CHANNELS,
          ACCESS,
          undefined,
          undefined,
          query
        )
      ).sessions.map((session) => session.id);
    return { ids, search, service };
  }

  test("matches the title and the text of user and assistant messages", async () => {
    const { ids, search } = await seedSearchable();
    expect(await search("budget")).toEqual([ids.title]);
    // The tool message also says "invoice"; only user and assistant text counts.
    expect(await search("INVOICE")).toEqual([ids.invoice]);
    expect(await search("total is ready")).toEqual([ids.array]);
  });

  test("ignores case for ASCII letters only", async () => {
    const { db, service } = await createService();
    const id = await seedChat(
      db,
      service,
      "web",
      [{ content: "notes", role: "user" }],
      "École d'été"
    );
    const search = async (query: string) =>
      (
        await service.listSessions(
          ORG_ID,
          "profile_default",
          CHANNELS,
          ACCESS,
          undefined,
          undefined,
          query
        )
      ).sessions.map((session) => session.id);
    expect(await search("ÉCOLE")).toEqual([id]);
    expect(await search("D'été")).toEqual([id]);
    // SQLite folds ASCII only: a non-ASCII letter matches in its own case.
    expect(await search("école")).toEqual([]);
  });

  test("does not match the raw message JSON", async () => {
    const { search } = await seedSearchable();
    expect(await search("role")).toEqual([]);
    expect(await search("content")).toEqual([]);
    expect(await search("type")).toEqual([]);
  });

  test("takes % and _ literally", async () => {
    const { ids, search } = await seedSearchable();
    expect(await search("100%")).toEqual([ids.array]);
    expect(await search("_")).toEqual([ids.snake]);
  });

  test("pages a filtered list to the end", async () => {
    const { ids, service } = await seedSearchable();
    const paged: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await service.listSessions(
        ORG_ID,
        "profile_default",
        CHANNELS,
        ACCESS,
        undefined,
        { cursor, limit: 1 },
        "i"
      );
      expect(page.stale).toBe(false);
      paged.push(...page.sessions.map((session) => session.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    const all = await service.listSessions(
      ORG_ID,
      "profile_default",
      CHANNELS,
      ACCESS,
      undefined,
      undefined,
      "i"
    );
    expect(paged).toEqual(all.sessions.map((session) => session.id));
    expect(paged).toContain(ids.invoice);
    expect(new Set(paged).size).toBe(paged.length);
  });
});
