import { describe, expect, spyOn, test } from "bun:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { createAgentChatSession } from "@nakama/agent";
import {
  type ChatMessage,
  getUserConfigDir,
  type ProviderClient,
  saveAttachmentBytes,
} from "@nakama/core";
import {
  createInMemoryDatabaseAdapter,
  createSqliteDatabase,
  type DatabaseAdapter,
} from "@nakama/db";
import { setupTestConfigDir } from "../test-config-dir";
import { AgentService } from "./agent-service";
import {
  createAttachmentLoader,
  createAttachmentSaver,
} from "./attachment-service";
import { ProfileService } from "./profile-service";
import {
  archiveSessionHistory,
  copySessionHistoryArchive,
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
    await replaceSessionHistory(db, branch!.sessionId, history);
    service.setAutomationTools([]);
    const detached = await service.sessions.get(branch!.sessionId, "org_1");
    service.setAutomationTools([]);
    expect(await service.clearSession(branch!.sessionId, "org_1")).toBe(true);
    await expect(detached!.compact({ force: true })).rejects.toThrow();
    await expect(
      readFile(sessionHistoryArchivePath("org_1", branch!.sessionId))
    ).rejects.toThrow();
    expect(await loadSessionHistory(db, branch!.sessionId)).toEqual([]);
  });

  test("purge removes attachment bytes and metadata", async () => {
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
    const service = new AgentService(null, null, db);
    const sessionId = await service.createSession("org_1", "web", "profile");

    const attachmentPath = await saveAttachmentBytes(
      "org_1",
      "profile",
      "attachment",
      Buffer.from("attachment")
    );

    await db.insertAttachment({
      channel: "web",
      createdAt: now,
      ephemeral: false,
      filename: "attachment.txt",
      id: "attachment",
      kind: "document",
      mediaType: "text/plain",
      orgId: "org_1",
      profileId: "profile",
      sessionId,
      sizeBytes: 10,
      storagePath: attachmentPath,
    });

    expect(await service.purgeSession(sessionId, "other-org")).toBe(false);
    expect(await readFile(attachmentPath, "utf8")).toBe("attachment");
    expect(await service.purgeSession(sessionId, "org_1")).toBe(true);
    await expect(readFile(attachmentPath)).rejects.toThrow();
    expect(await db.getAttachment("attachment")).toBeNull();
  });

  test("a branch keeps its attachments after the source session is purged", async () => {
    const database = await openDatabaseWithProfiles(
      ["org_1", "profile"],
      ["org_2", "other-profile"]
    );

    const db = database.adapter;

    try {
      const service = new AgentService(null, null, db);
      const sourceId = await service.createSession("org_1", "web", "profile");

      const { attachmentId } = await createAttachmentSaver(db, {
        channel: "web",
        orgId: "org_1",
        profileId: "profile",
        sessionId: sourceId,
      })({
        bytes: Buffer.from("shared"),
        kind: "image",
        mediaType: "image/png",
      });

      const history: ChatMessage[] = [
        {
          content: [
            {
              attachmentId,
              mediaType: "image/png",
              size: 6,
              type: "image_ref",
            },
          ],
          role: "user",
        },
      ];

      await replaceSessionHistory(db, sourceId, history);

      // Another organization naming the same id must not keep the file alive.
      const foreignId = await service.createSession(
        "org_2",
        "web",
        "other-profile"
      );

      await replaceSessionHistory(db, foreignId, history);

      const load = createAttachmentLoader(db, {
        orgId: "org_1",
        profileId: "profile",
      });

      const branch = await service.branchSession(sourceId, 0, "org_1");
      expect(await service.purgeSession(sourceId, "org_1")).toBe(true);
      expect((await load(attachmentId))?.bytes.toString()).toBe("shared");

      expect(await service.purgeSession(branch!.sessionId, "org_1")).toBe(true);
      expect(await load(attachmentId)).toBeNull();
      expect(await db.getAttachment(attachmentId)).toBeNull();
    } finally {
      database.close();
    }
  });

  test("clearing or purging a turn leaves no history behind", async () => {
    for (const [method, cache] of [
      ["clearSession", "cached"],
      ["clearSession", "evicted"],
      ["purgeSession", "cached"],
      ["purgeSession", "evicted"],
    ] as const) {
      const database = await openDatabaseWithProfiles(["org_1", "profile"]);
      const db = database.adapter;

      try {
        const service = new AgentService(null, null, db);

        const sessionId = await service.createSession(
          "org_1",
          "web",
          "profile"
        );

        const session = await service.sessions.get(sessionId, "org_1");
        const paused = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();

        // The wrapper persists the user message, then calls this: the turn is
        // held open exactly where a provider call would be.
        const turn = session!.send("hello", {
          async onUserMessage() {
            paused.resolve();
            await release.promise;
          },
        });

        await paused.promise;
        expect(await db.listMessagesForSession(sessionId)).toHaveLength(1);

        if (cache === "evicted") {
          // A profile edit drops the cached session while its turn still runs.
          await service.updateProfile("org_1", "profile", { model: null });
        }

        expect(await service[method](sessionId, "org_1")).toBe(true);
        release.resolve();
        await turn;

        expect(await db.listMessagesForSession(sessionId)).toEqual([]);

        if (method === "clearSession") {
          expect(
            (await service.getSessionMessages(sessionId, "org_1"))?.messages
          ).toEqual([]);
          const next = await service.sessions.get(sessionId, "org_1");
          expect(next!.getHistory()).toEqual([]);
        }
      } finally {
        database.close();
      }
    }
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

        const retired = join(
          getUserConfigDir(),
          "retired-app-users",
          orgId,
          profileId
        );

        await mkdir(retired, { recursive: true });
        await Bun.write(join(retired, "private.txt"), "retired data");
      }

      const path = sessionHistoryArchivePath("org_1", "deleted");
      await rm(path);
      await mkdir(path);
      const service = new ProfileService(db);
      await expect(service.deleteProfile("org_1", "deleted")).rejects.toThrow();
      expect(await db.getProfile("deleted")).not.toBeNull();
      expect(await db.getSession("deleted")).not.toBeNull();
      await rm(path, { recursive: true });

      await archiveSessionHistory(db, "org_1", "deleted", historyWithTool());
      await service.deleteProfile("org_1", "deleted");
      expect(await db.getProfile("deleted")).toBeNull();
      expect(await db.getSession("deleted")).toBeNull();
      await expect(
        archiveSessionHistory(db, "org_1", "deleted", historyWithTool())
      ).rejects.toThrow();
      await expect(
        copySessionHistoryArchive(db, "org_1", "kept", "deleted")
      ).rejects.toThrow();
      await expect(readFile(path)).rejects.toThrow();
      await expect(
        readFile(
          join(
            getUserConfigDir(),
            "retired-app-users",
            "org_1",
            "deleted",
            "private.txt"
          )
        )
      ).rejects.toThrow();

      for (const [orgId, id] of [
        ["org_1", "kept"],
        ["org_2", "other"],
      ]) {
        expect(await db.getSession(id)).not.toBeNull();
        expect(
          await readFile(
            join(
              getUserConfigDir(),
              "retired-app-users",
              orgId,
              id,
              "private.txt"
            ),
            "utf8"
          )
        ).toBe("retired data");
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
    const session = createAgentChatSession(
      { provider: summaryProvider },
      { initialHistory: historyWithTool() }
    );

    const db = createInMemoryDatabaseAdapter();

    // An unawaited call here rejects with nowhere to report, and Bun ends the
    // process on an unhandled rejection. AgentService.clearSession awaits the
    // same delete right after, so this wrapper must not repeat it.
    const deleteSpy = spyOn(db, "deleteMessagesForSession").mockImplementation(
      () => {
        throw new Error("clear() must not delete messages");
      }
    );

    try {
      wrapPersistedSession("session_1", session, db).clear();

      expect(session.getHistory()).toEqual([]);
      expect(deleteSpy).not.toHaveBeenCalled();
    } finally {
      deleteSpy.mockRestore();
    }
  });
});
