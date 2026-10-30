import { describe, expect, spyOn, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { createAgentChatSession } from "@nakama/agent";
import type { ChatMessage, ProviderClient } from "@nakama/core";
import {
  createInMemoryDatabaseAdapter,
  createSqliteDatabase,
  type DatabaseAdapter,
} from "@nakama/db";
import { setupTestConfigDir } from "../test-config-dir";
import { AgentService } from "./agent-service";
import {
  archiveSessionHistory,
  copySessionHistoryArchive,
  createReadSessionHistoryTool,
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

/** Foreign keys on, as in production: the in-memory adapter turns them off. */
async function openDatabaseWithProfiles(
  ...profiles: [orgId: string, profileId: string][]
) {
  const database = await createSqliteDatabase(":memory:");
  const now = new Date().toISOString();

  for (const [orgId, id] of profiles) {
    await database.adapter.upsertOrganization({
      createdAt: now,
      id: orgId,
      name: orgId,
      slug: orgId,
      updatedAt: now,
    });
    await database.adapter.upsertProfile({
      createdAt: now,
      id,
      isDefault: true,
      isSuper: false,
      model: null,
      name: id,
      orgId,
      systemPrompt: "",
      updatedAt: now,
    });
  }

  return database;
}

describe("session persistence", () => {
  setupTestConfigDir("nakama-history-archive-");

  test("cached sessions and history tools recheck eligibility before exposing history", async () => {
    const db = createInMemoryDatabaseAdapter();
    await seedSession(db, "retired");
    await seedSession(db, "target");
    await archiveSessionHistory(db, "org_1", "retired", historyWithTool());
    const tool = createReadSessionHistoryTool(db, "org_1", "retired");
    expect(await tool.run({}, {})).toMatchObject({
      content: expect.any(String),
    });
    const service = new AgentService(null, null, db);
    await db.upsertProfile({
      createdAt: "now",
      id: "profile",
      isDefault: true,
      isSuper: false,
      model: null,
      name: "Test",
      orgId: "org_1",
      systemPrompt: "",
      updatedAt: "now",
    });
    expect(await service.sessions.get("retired", "org_1")).not.toBeNull();
    const originalGet = db.getSession.bind(db);

    const read = spyOn(db, "getSession").mockImplementation((id) =>
      id === "retired" ? Promise.resolve(null) : originalGet(id)
    );

    try {
      expect(await service.sessions.get("retired", "org_1")).toBeNull();
      await expect(tool.run({}, {})).rejects.toThrow();
      await expect(
        copySessionHistoryArchive(db, "org_1", "retired", "target")
      ).rejects.toThrow();
    } finally {
      read.mockRestore();
    }
  });

  for (const stream of [false, true]) {
    test(`saves the user message before the provider fails (stream: ${stream})`, async () => {
      const db = createInMemoryDatabaseAdapter();
      await seedSession(db, "failed");

      const expected: ChatMessage[] = [
        { content: "Please help", role: "user" },
      ];

      let savedBeforeRequest: ChatMessage[] = [];

      const provider: ProviderClient = {
        ...summaryProvider,
        async generateChat() {
          savedBeforeRequest = await loadSessionHistory(db, "failed");
          throw new Error("Provider unavailable");
        },
      };

      const session = wrapPersistedSession(
        "failed",
        createAgentChatSession({ provider }),
        db
      );

      await expect(
        stream
          ? session.sendStream("Please help", { onChunk() {} })
          : session.send("Please help")
      ).rejects.toThrow("Provider unavailable");
      expect(savedBeforeRequest).toEqual(expected);
      expect(session.getHistory()).toEqual(expected);
      const saved = await loadSessionHistory(db, "failed");
      expect(saved).toEqual(expected);
      let nextMessages: readonly ChatMessage[] = [];

      const reopened = wrapPersistedSession(
        "failed",
        createAgentChatSession(
          {
            provider: {
              ...summaryProvider,
              generateChat(input) {
                nextMessages = [...input.messages];

                return summaryProvider.generateChat(input);
              },
            },
          },
          { initialHistory: saved }
        ),
        db
      );

      await reopened.send("Continue");
      expect(nextMessages[0]).toEqual(expected[0]);
      expect(await loadSessionHistory(db, "failed")).toHaveLength(3);
    });
  }

  for (const cancelled of [false, true]) {
    test(`handles a turn with no output (cancelled: ${cancelled})`, async () => {
      const db = createInMemoryDatabaseAdapter();
      await seedSession(db, "empty");
      const controller = new AbortController();

      const session = wrapPersistedSession(
        "empty",
        createAgentChatSession({
          provider: {
            ...summaryProvider,
            streamChat() {
              if (cancelled) {
                controller.abort();
              }

              return Promise.reject(new Error("Interrupted"));
            },
          },
        }),
        db
      );

      await expect(
        session.sendStream(
          "Keep my request",
          { onChunk() {} },
          { signal: controller.signal }
        )
      ).rejects.toThrow();
      expect(await loadSessionHistory(db, "empty")).toEqual([
        { content: "Keep my request", role: "user" },
      ]);
    });
  }

  for (const ignoresAbort of [false, true]) {
    test(`saves a stopped reply and reuses it after reopening (ignores abort: ${ignoresAbort})`, async () => {
      const db = createInMemoryDatabaseAdapter();
      await seedSession(db, "stopped");
      const controller = new AbortController();

      const provider: ProviderClient = {
        ...summaryProvider,
        async streamChat(input, handlers) {
          handlers.onThinking?.("Considering the request");
          handlers.onChunk("Partial ");
          handlers.onChunk("reply");
          controller.abort();

          if (!ignoresAbort) {
            input.signal?.throwIfAborted();
          }

          handlers.onChunk("late output");

          return summaryProvider.generateChat(input);
        },
      };

      const session = wrapPersistedSession(
        "stopped",
        createAgentChatSession({ provider }),
        db
      );

      await expect(
        session.sendStream(
          "Help me",
          { onChunk() {} },
          { signal: controller.signal }
        )
      ).rejects.toThrow();
      const stored = await loadSessionHistory(db, "stopped");
      expect(stored).toEqual([
        { content: "Help me", role: "user" },
        {
          content: "Partial reply",
          role: "assistant",
          thinking: "Considering the request",
          thinkingDurationMs: expect.any(Number),
        },
      ]);
      let nextMessages: readonly ChatMessage[] = [];

      const reopened = wrapPersistedSession(
        "stopped",
        createAgentChatSession(
          {
            provider: {
              ...summaryProvider,
              generateChat(input) {
                nextMessages = [...input.messages];

                return summaryProvider.generateChat(input);
              },
            },
          },
          { initialHistory: stored }
        ),
        db
      );

      await reopened.send("Continue");
      expect(nextMessages.slice(0, 2)).toEqual(stored);
      expect(await loadSessionHistory(db, "stopped")).toHaveLength(4);
    });
  }

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
    const tool = createReadSessionHistoryTool(db, "org_1", "session_1");
    let content = "";
    let offset = 0;

    for (;;) {
      // SAFETY: The test fixture matches the contract used by this test.
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
      createReadSessionHistoryTool(db, "org_2", "session_1").run({}, {})
    ).rejects.toThrow();
    await expect(
      createReadSessionHistoryTool(db, "org_1", "session_2").run({}, {})
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
});
