import { describe, expect, test } from "bun:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import { type AgentChatSession, createAgentChatSession } from "@nakama/agent";
import type { ChatMessage, ProviderClient } from "@nakama/core";
import {
  createInMemoryDatabaseAdapter,
  createSqliteDatabase,
  type DatabaseAdapter,
} from "@nakama/db";
import { setupTestConfigDir } from "../test-config-dir";
import { AgentService } from "./agent-service";
import { ProfileService } from "./profile-service";
import {
  archiveSessionHistory,
  copySessionHistoryArchive,
  createReadSessionHistoryTool,
  deleteSessionHistoryArchive,
  loadSessionHistory,
  replaceSessionHistory,
  sessionHistoryArchivePath,
  wrapPersistedSession,
} from "./session-persistence";

const summaryProvider: ProviderClient = {
  async generateChat() {
    return {
      assistantMessage: { content: "Summary", role: "assistant" },
      content: "Summary",
      toolCalls: [],
    };
  },
  async generateText() {
    return { content: "Summary" };
  },
  name: "openai",
  streamChat(input, handlers) {
    handlers.onChunk("Summary");
    return this.generateChat(input);
  },
};

function historyWithTool(): ChatMessage[] {
  return [
    { content: "Read the document", role: "user" },
    {
      content: "",
      role: "assistant",
      toolCalls: [
        { arguments: { path: "notes.txt" }, id: "call", name: "read_file" },
      ],
    },
    {
      content: "Original result: 日本語 🐱",
      name: "read_file",
      role: "tool",
      toolCallId: "call",
    },
    { content: "Read it", role: "assistant" },
    { content: "Next", role: "user" },
    { content: "Done", role: "assistant" },
    { content: "Continue", role: "user" },
    { content: "Done again", role: "assistant" },
  ];
}

async function seedSession(
  db: DatabaseAdapter,
  id: string,
  profileId = "profile",
  orgId = "org_1"
) {
  await db.upsertSession({
    agentQuestionnaire: null,
    agentTodos: [],
    channel: "web",
    createdAt: new Date().toISOString(),
    id,
    model: null,
    orgId,
    profileId,
    title: null,
  });
}

describe("wrapPersistedSession", () => {
  setupTestConfigDir("nakama-history-archive-");

  test("compaction replaces working history but preserves raw messages for scoped recovery", async () => {
    const db = createInMemoryDatabaseAdapter();
    await seedSession(db, "session_1");
    const original = historyWithTool();
    await replaceSessionHistory(db, "session_1", original);
    const session = createAgentChatSession(
      { provider: summaryProvider },
      {
        archiveHistory: (history) =>
          archiveSessionHistory(db, "org_1", "session_1", history),
        compaction: { contextWindow: 100_000, maxOutputTokens: 8192 },
        initialHistory: original,
      }
    );
    const wrapped = wrapPersistedSession("session_1", session, db);
    expect((await wrapped.compact({ force: true })).action).toBe("summarized");
    const working = await loadSessionHistory(db, "session_1");
    expect(working.length).toBeLessThan(original.length);
    expect(working.some((message) => message.role === "tool")).toBe(false);
    const archived = JSON.parse(
      await readFile(sessionHistoryArchivePath("org_1", "session_1"), "utf8")
    );
    expect(archived.messages).toEqual(original);
    const tool = createReadSessionHistoryTool("org_1", "session_1");
    let content = "";
    let offset = 0;
    for (;;) {
      const page = (await tool.run(
        { limit: 17, offset, orgId: "other-org", sessionId: "other-session" },
        {}
      )) as { content: string; nextOffset: number; done: boolean };
      content += page.content;
      expect(page.nextOffset).toBeGreaterThan(offset);
      offset = page.nextOffset;
      if (page.done) {
        break;
      }
    }
    expect(JSON.parse(content).messages).toEqual(original);
    await wrapped.send("Another turn");
    await wrapped.compact({ force: true });
    const snapshots = (
      await readFile(sessionHistoryArchivePath("org_1", "session_1"), "utf8")
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0].messages).toEqual(original);
    expect(snapshots[1].messages).toContainEqual({
      content: "Another turn",
      role: "user",
    });
    await expect(
      createReadSessionHistoryTool("org_2", "session_1").run({}, {})
    ).rejects.toThrow();
    await expect(
      createReadSessionHistoryTool("org_1", "session_2").run({}, {})
    ).rejects.toThrow();
  });

  test("a failed archive leaves history and revision intact", async () => {
    const original = historyWithTool();
    const session = createAgentChatSession(
      { provider: summaryProvider },
      {
        archiveHistory() {
          throw new Error("Archive unavailable");
        },
        compaction: { contextWindow: 100_000, maxOutputTokens: 8192 },
        initialHistory: original,
      }
    );
    await expect(session.compact({ force: true })).rejects.toThrow();
    expect(session.getHistory()).toEqual(original);
    expect(session.getHistoryRevision()).toBe(0);
  });

  test.each(["send", "stream"])(
    "automatic %s pruning archives original output but not no-op turns",
    async (mode) => {
      const db = createInMemoryDatabaseAdapter();
      await seedSession(db, "automatic");
      const original = historyWithTool();
      original[2] = {
        content: "x".repeat(200_000),
        name: "read_file",
        role: "tool",
        toolCallId: "call",
      };
      const session = createAgentChatSession(
        { provider: summaryProvider },
        {
          archiveHistory: (history) =>
            archiveSessionHistory(db, "org_1", "automatic", history),
          compaction: { contextWindow: 100_000, maxOutputTokens: 8192 },
          initialHistory: original,
        }
      );
      if (mode === "stream") {
        await session.sendStream("Proceed", { onChunk() {} });
      } else {
        await session.send("Proceed");
      }
      const path = sessionHistoryArchivePath("org_1", "automatic");
      const first = await readFile(path, "utf8");
      expect(JSON.parse(first).messages).toEqual([
        ...original,
        { content: "Proceed", role: "user" },
      ]);
      expect(session.getHistory()[2]?.content.length).toBeLessThan(1000);
      await session.send("Continue");
      expect(await readFile(path, "utf8")).toBe(first);
    }
  );

  test("branch archives survive source purge and are removed on clear", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();
    await db.upsertProfile({
      createdAt: now,
      id: "profile",
      isDefault: true,
      isSuper: false,
      model: null,
      name: "Test",
      orgId: "org_1",
      systemPrompt: "",
      updatedAt: now,
    });
    let service = new AgentService(null, null, db);
    const id = await service.createSession("org_1", "web", "profile");
    const history = historyWithTool();
    await replaceSessionHistory(db, id, history);
    // Reload the persisted session through the production service wiring.
    service = new AgentService(null, null, db);
    Object.assign(service, {
      createHarnessForProfile: () => ({ provider: summaryProvider }),
      resolveCompactionConfig: () => ({
        contextWindow: 100_000,
        maxOutputTokens: 8192,
      }),
    });
    expect(
      (await service.compactSession(id, { force: true }, "org_1"))?.action
    ).toBe("summarized");
    const saved = await readFile(
      sessionHistoryArchivePath("org_1", id),
      "utf8"
    );
    expect(JSON.parse(saved).messages).toEqual(history);
    const branch = await service.branchSession(id, 0, "org_1");
    expect(branch).not.toBeNull();
    expect(await service.purgeSession(id, "other-org")).toBe(false);
    expect(await service.clearSession(id, "other-org")).toBe(false);
    const source = await readFile(
      sessionHistoryArchivePath("org_1", id),
      "utf8"
    );
    expect(await service.purgeSession(id, "org_1")).toBe(true);
    await expect(
      readFile(sessionHistoryArchivePath("org_1", id))
    ).rejects.toThrow();
    expect(
      await readFile(
        sessionHistoryArchivePath("org_1", branch!.sessionId),
        "utf8"
      )
    ).toBe(source);
    expect(await service.clearSession(branch!.sessionId, "org_1")).toBe(true);
    await expect(
      readFile(sessionHistoryArchivePath("org_1", branch!.sessionId))
    ).rejects.toThrow();
    expect(await loadSessionHistory(db, branch!.sessionId)).toEqual([]);
  });

  test("clear during an archive write does not resurrect history or leave an archive", async () => {
    const db = createInMemoryDatabaseAdapter();
    await seedSession(db, "cleared");
    let writing: Promise<string> | undefined;
    const session = createAgentChatSession(
      { provider: summaryProvider },
      {
        archiveHistory(history) {
          writing = archiveSessionHistory(db, "org_1", "cleared", history);
          session.clear();
          const deletion = deleteSessionHistoryArchive("org_1", "cleared");
          return Promise.all([writing, deletion]).then(([pointer]) => pointer);
        },
        compaction: { contextWindow: 100_000, maxOutputTokens: 8192 },
        initialHistory: historyWithTool(),
      }
    );
    await expect(session.compact({ force: true })).rejects.toThrow();
    expect(writing).toBeDefined();
    expect(session.getHistory()).toEqual([]);
    await expect(
      readFile(sessionHistoryArchivePath("org_1", "cleared"))
    ).rejects.toThrow();
  });

  test("profile deletion cleans archives, rejects late writers, and can retry failed cleanup", async () => {
    const database = await createSqliteDatabase(":memory:");
    const db = database.adapter;
    try {
      const now = new Date().toISOString();
      for (const [orgId, profileId] of [
        ["org_1", "deleted"],
        ["org_1", "kept"],
        ["org_2", "other"],
      ]) {
        await db.upsertOrganization({
          createdAt: now,
          id: orgId,
          name: orgId,
          slug: orgId,
          updatedAt: now,
        });
        await db.upsertProfile({
          createdAt: now,
          id: profileId,
          isDefault: false,
          isSuper: false,
          model: null,
          name: profileId,
          orgId,
          systemPrompt: "",
          updatedAt: now,
        });
        await seedSession(db, profileId, profileId, orgId);
        await archiveSessionHistory(db, orgId, profileId, historyWithTool());
      }
      const path = sessionHistoryArchivePath("org_1", "deleted");
      await rm(path);
      await mkdir(path);
      const service = new ProfileService(db);
      await expect(service.deleteProfile("org_1", "deleted")).rejects.toThrow();
      expect(await db.getProfile("deleted")).not.toBeNull();
      expect(await db.getSession("deleted")).not.toBeNull();
      await rm(path, { recursive: true });

      let queuedWrites: Promise<PromiseSettledResult<unknown>[]> | undefined;
      const concurrentDb = new Proxy(db, {
        get(target, property, receiver) {
          if (property === "listSessions") {
            return async () => {
              const snapshot = await db.listSessions();
              // A session created after enumeration must not escape cleanup.
              await seedSession(db, "late", "deleted");
              queuedWrites = Promise.allSettled([
                archiveSessionHistory(db, "org_1", "late", historyWithTool()),
                copySessionHistoryArchive(db, "org_1", "kept", "late"),
              ]);
              return snapshot;
            };
          }
          return Reflect.get(target, property, receiver);
        },
      });
      const writing = archiveSessionHistory(
        db,
        "org_1",
        "deleted",
        historyWithTool()
      );
      await new AgentService(null, null, concurrentDb).deleteProfile(
        "org_1",
        "deleted"
      );
      await writing;
      expect((await queuedWrites)?.map((result) => result.status)).toEqual([
        "rejected",
        "rejected",
      ]);
      expect(await db.getSession("late")).toBeNull();
      await expect(
        readFile(sessionHistoryArchivePath("org_1", "late"))
      ).rejects.toThrow();
      expect(await db.getProfile("deleted")).toBeNull();
      expect(await db.getSession("deleted")).toBeNull();
      await expect(
        archiveSessionHistory(db, "org_1", "deleted", historyWithTool())
      ).rejects.toThrow();
      await expect(
        copySessionHistoryArchive(db, "org_1", "kept", "deleted")
      ).rejects.toThrow();
      await expect(readFile(path)).rejects.toThrow();
      for (const [orgId, id] of [
        ["org_1", "kept"],
        ["org_2", "other"],
      ]) {
        expect(await db.getSession(id)).not.toBeNull();
        expect(
          JSON.parse(
            await readFile(sessionHistoryArchivePath(orgId, id), "utf8")
          ).messages
        ).toEqual(historyWithTool());
      }
    } finally {
      database.close();
    }
  });

  test("clear leaves the delete to clearSession instead of firing it unawaited", () => {
    let cleared = false;
    const session = {
      clear() {
        cleared = true;
      },
      getHistoryRevision: () => 0,
    } as unknown as AgentChatSession;

    // An unawaited call here rejects with nowhere to report, and Bun ends the
    // process on an unhandled rejection. AgentService.clearSession awaits the
    // same delete right after, so this wrapper must not repeat it.
    const db = {
      deleteMessagesForSession() {
        throw new Error("clear() must not delete messages");
      },
    } as unknown as DatabaseAdapter;

    wrapPersistedSession("session_1", session, db).clear();

    expect(cleared).toBe(true);
  });
});
