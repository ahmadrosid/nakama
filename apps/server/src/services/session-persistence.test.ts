import { describe, expect, test } from "bun:test";
import { mkdir, readFile } from "node:fs/promises";
import { type AgentChatSession, createAgentChatSession } from "@nakama/agent";
import {
  type ChatMessage,
  getGlobalSkillsDir,
  getProfileSoulDir,
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
import { ProfileService } from "./profile-service";
import {
  archiveSessionHistory,
  createReadSessionHistoryTool,
  deleteSessionHistoryArchive,
  loadSessionHistory,
  replaceSessionHistory,
  sessionHistoryArchivePath,
  wrapPersistedSession,
} from "./session-persistence";
import { SkillsService } from "./skills-service";

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

describe("session persistence", () => {
  setupTestConfigDir("nakama-history-archive-");

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
      await readFile(
        sessionHistoryArchivePath("org_1", "session_1", {
          id: "chat-session_1",
          kind: "chat",
        }),
        "utf8"
      )
    );
    expect(archived.messages).toEqual(original);
    const tool = createReadSessionHistoryTool("org_1", "session_1", db);
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
      await readFile(
        sessionHistoryArchivePath("org_1", "session_1", {
          id: "chat-session_1",
          kind: "chat",
        }),
        "utf8"
      )
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
      createReadSessionHistoryTool("org_2", "session_1", db).run({}, {})
    ).rejects.toThrow();
    await expect(
      createReadSessionHistoryTool("org_1", "session_2", db).run({}, {})
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
      const path = sessionHistoryArchivePath("org_1", "automatic", {
        id: "chat-automatic",
        kind: "chat",
      });
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
      sessionHistoryArchivePath("org_1", id, {
        id: (await db.getSession(id))!.workspaceId!,
        kind: "chat",
      }),
      "utf8"
    );
    expect(JSON.parse(saved).messages).toEqual(history);
    const branch = await service.branchSession(id, 0, "org_1");
    expect(branch).not.toBeNull();
    expect(await service.purgeSession(id, "other-org")).toBe(false);
    expect(await service.clearSession(id, "other-org")).toBe(false);
    const source = await readFile(
      sessionHistoryArchivePath("org_1", id, {
        id: (await db.getSession(id))!.workspaceId!,
        kind: "chat",
      }),
      "utf8"
    );
    const sourceWorkspaceId = (await db.getSession(id))!.workspaceId!;
    expect(await service.purgeSession(id, "org_1")).toBe(true);
    await expect(
      readFile(
        sessionHistoryArchivePath("org_1", id, {
          id: sourceWorkspaceId,
          kind: "chat",
        })
      )
    ).rejects.toThrow();
    expect(
      await readFile(
        sessionHistoryArchivePath("org_1", branch!.sessionId, {
          id: (await db.getSession(branch!.sessionId))!.workspaceId!,
          kind: "chat",
        }),
        "utf8"
      )
    ).toBe(source);
    await replaceSessionHistory(db, branch!.sessionId, history);
    service.setAutomationTools([]);
    const detached = await service.resolveSession(branch!.sessionId, "org_1");
    service.setAutomationTools([]);
    expect(await service.clearSession(branch!.sessionId, "org_1")).toBe(true);
    await expect(detached!.compact({ force: true })).rejects.toThrow();
    await expect(
      readFile(
        sessionHistoryArchivePath("org_1", branch!.sessionId, {
          id: (await db.getSession(branch!.sessionId))!.workspaceId!,
          kind: "chat",
        })
      )
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

  test("profile deletion preserves chat archives and detaches the current agent", async () => {
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
      const path = sessionHistoryArchivePath("org_1", "deleted", {
        id: "chat-deleted",
        kind: "chat",
      });
      const original = await readFile(path, "utf8");
      const service = new ProfileService(db);
      await service.deleteProfile("org_1", "deleted");
      expect(await db.getProfile("deleted")).toBeNull();
      expect((await db.getSession("deleted"))?.activeProfileId).toBeNull();
      expect(await readFile(path, "utf8")).toBe(original);
      for (const [orgId, id] of [
        ["org_1", "kept"],
        ["org_2", "other"],
      ]) {
        expect(await db.getSession(id)).not.toBeNull();
        expect(
          JSON.parse(
            await readFile(
              sessionHistoryArchivePath(orgId, id, {
                id: `chat-${id}`,
                kind: "chat",
              }),
              "utf8"
            )
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
      getHistory: () => [],
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

describe("chat and project storage", () => {
  setupTestConfigDir("nakama-workspaces-");

  async function setup() {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();
    await db.upsertOrganization({
      createdAt: now,
      id: "org_test",
      name: "Org",
      slug: "org_test",
      updatedAt: now,
    });
    await db.upsertProfile({
      createdAt: now,
      id: "workspace_agent",
      isDefault: true,
      isSuper: false,
      model: null,
      name: "Agent",
      orgId: "org_test",
      systemPrompt: "",
      updatedAt: now,
    });
    const agent = new AgentService(null, null, db);
    return { agent, db };
  }

  test.each(["chat", "project"] as const)(
    "an assigned skill writes to each chat's output folder (%s)",
    async (kind) => {
      const { db, agent } = await setup();
      const skills = new SkillsService(db);
      const { skill } = await skills.createSkill("org_test", {
        body: "Write a report for the current chat.",
        description: "Write a report",
        name: "workspace-report",
      });
      const skillRoot = `${getGlobalSkillsDir()}/workspace-report`;
      await Bun.write(`${skillRoot}/template.txt`, "Report");
      await Bun.write(
        `${skillRoot}/tool.js`,
        `import { readFile, writeFile } from "node:fs/promises";
export async function run(input, context) {
  const template = await readFile(new URL("./template.txt", import.meta.url), "utf8");
  await writeFile(context.outputRoot + "/report.txt", template + ": " + context.sessionId);
  return { saved: true };
}`
      );
      await db.assignSkillToProfile("workspace_agent", skill.id);
      agent.setSkillsService(skills);
      const provider: ProviderClient = {
        ...summaryProvider,
        async generateChat(input) {
          if (input.messages.at(-1)?.role !== "user") {
            return summaryProvider.generateChat(input);
          }
          expect(input.tools?.map((tool) => tool.name)).toContain(
            "workspace-report"
          );
          const toolCalls = [
            { arguments: {}, id: "report", name: "workspace-report" },
          ];
          return {
            assistantMessage: { content: "", role: "assistant", toolCalls },
            content: "",
            toolCalls,
          };
        },
      };
      Object.assign(agent, {
        _providerConfigured: true,
        createHarnessForProfile: () => ({ provider }),
      });
      const project =
        kind === "project"
          ? await agent.chatWorkspaces.create(
              "org_test",
              "project",
              "Reports",
              null
            )
          : null;
      const outputs = [];
      for (let i = 0; i < 2; i++) {
        const id = await agent.createSession(
          "org_test",
          "web",
          "workspace_agent",
          null,
          {
            orgRole: "admin",
            workspaceId: project?.id,
          }
        );
        const session = await agent.resolveSession(id, "org_test");
        expect(session).not.toBeNull();
        await session!.send({ message: "Write a report" });
        const roots = await agent.chatWorkspaces.roots(
          (await db.getSession(id))!
        );
        outputs.push({ id, path: `${roots.outputRoot}/report.txt` });
      }
      expect(outputs[0].path).not.toBe(outputs[1].path);
      for (const output of outputs) {
        expect(await readFile(output.path, "utf8")).toBe(
          `Report: ${output.id}`
        );
      }
      const identityRoot = getProfileSoulDir("org_test", "workspace_agent");
      for (const root of [
        skillRoot,
        identityRoot,
        `${identityRoot}/artifacts`,
      ]) {
        expect(await Bun.file(`${root}/report.txt`).exists()).toBe(false);
      }
    }
  );

  test("new chats own distinct folders, output ids, and identity roots", async () => {
    const { db, agent } = await setup();
    const ids = await Promise.all([
      agent.createSession("org_test", "web", "workspace_agent"),
      agent.createSession("org_test", "web", "workspace_agent"),
    ]);
    const { runWriteFile, runReadFile } = await import(
      "@nakama/core/tools/builtin"
    );
    const roots = [];
    for (const id of ids) {
      const record = (await db.getSession(id))!;
      const root = await agent.chatWorkspaces.roots(record);
      roots.push(root);
      const context = {
        ...root,
        orgId: "org_test",
        profileId: "workspace_agent",
        registerGeneratedFile: (path: string) =>
          agent.chatWorkspaces.registerFile(
            root.workspaceId,
            "org_test",
            id,
            path
          ),
        sessionId: id,
      };
      const output = await runWriteFile(
        { content: id, path: "artifacts/result.txt" },
        context
      );
      expect(output.workspaceId).toBe(root.workspaceId);
      expect(output.fileId).toBeTruthy();
      const files = await agent.chatWorkspaces.files(
        (await db.getWorkspace(root.workspaceId))!
      );
      expect(files.map((file) => file.path)).toEqual(["outputs/result.txt"]);
      await expect(
        runReadFile({ path: "../escape" }, context)
      ).rejects.toThrow();
    }
    expect(roots[0].workspaceRoot).not.toBe(roots[1].workspaceRoot);
    expect(await readFile(`${roots[0].outputRoot}/result.txt`, "utf8")).toBe(
      ids[0]
    );
    expect(await readFile(`${roots[1].outputRoot}/result.txt`, "utf8")).toBe(
      ids[1]
    );
  });

  test("project chats share references, isolate inputs, and survive another chat's deletion", async () => {
    const { db, agent } = await setup();
    const project = await agent.chatWorkspaces.create(
      "org_test",
      "project",
      "Research",
      null
    );
    const ids = [];
    for (let i = 0; i < 2; i++) {
      ids.push(
        await agent.createSession("org_test", "web", "workspace_agent", null, {
          orgRole: "admin",
          workspaceId: project.id,
        })
      );
    }
    const first = await agent.chatWorkspaces.roots(
      (await db.getSession(ids[0]))!
    );
    const second = await agent.chatWorkspaces.roots(
      (await db.getSession(ids[1]))!
    );
    expect(first.workspaceRoot).toBe(second.workspaceRoot);
    expect(first.chatRoot).not.toBe(second.chatRoot);
    await Bun.write(`${first.workspaceRoot}/references/shared.txt`, "shared");
    await Bun.write(`${first.chatRoot}/inputs/local.txt`, "private input");
    await Bun.write(`${first.outputRoot}/result.txt`, "private output");
    const generated = await agent.chatWorkspaces.registerFile(
      project.id,
      "org_test",
      ids[0],
      `${first.outputRoot}/result.txt`
    );
    expect(generated.path).toBe(`chats/${ids[0]}/outputs/result.txt`);
    const files = await agent.chatWorkspaces.files(project, ids[0]);
    expect(files).toHaveLength(3);
    expect(files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "references/shared.txt",
          purpose: "reference",
          sessionId: null,
        }),
        expect.objectContaining({
          path: `chats/${ids[0]}/inputs/local.txt`,
          purpose: "input",
          sessionId: ids[0],
        }),
        expect.objectContaining({
          id: generated.fileId,
          path: generated.path,
          purpose: "output",
          sessionId: ids[0],
        }),
      ])
    );
    expect(await agent.chatWorkspaces.files(project, ids[1])).toEqual([
      expect.objectContaining({ path: "references/shared.txt" }),
    ]);
    const { createAttachmentSaver, createAttachmentLoader } = await import(
      "./attachment-service"
    );
    const reference = await createAttachmentSaver(db, {
      channel: "web",
      chatRoot: first.workspaceRoot,
      orgId: "org_test",
      profileId: "workspace_agent",
      purpose: "reference",
      sessionId: null,
      workspaceId: project.id,
      workspaceRoot: first.workspaceRoot,
    })({
      bytes: Buffer.from("shared reference"),
      filename: "reference.txt",
      kind: "document",
      mediaType: "text/plain",
    });
    const input = await createAttachmentSaver(db, {
      ...first,
      channel: "web",
      orgId: "org_test",
      profileId: "workspace_agent",
      sessionId: ids[0],
    })({
      bytes: Buffer.from("first chat only"),
      filename: "private.txt",
      kind: "document",
      mediaType: "text/plain",
    });
    const loader = createAttachmentLoader(db, {
      ...second,
      orgId: "org_test",
      profileId: "workspace_agent",
      sessionId: ids[1],
    });
    expect((await loader(reference.attachmentId))?.bytes.toString()).toBe(
      "shared reference"
    );
    expect(await loader(input.attachmentId)).toBeNull();
    expect(
      (
        await agent.listSessions("org_test", undefined, "web", {
          orgRole: "admin",
        })
      ).sessions
    ).toHaveLength(0);
    expect(
      (
        await agent.listSessions(
          "org_test",
          undefined,
          "web",
          { orgRole: "admin" },
          project.id
        )
      ).sessions
    ).toHaveLength(2);
    await expect(
      agent.validateSessionAttachments(ids[1], "org_test", [input.attachmentId])
    ).rejects.toMatchObject({ status: 404 });
    expect(
      await agent.validateSessionAttachments(ids[1], "org_test", [
        reference.attachmentId,
      ])
    ).toHaveLength(1);
    await agent.purgeSession(ids[0], "org_test");
    expect(await db.getSession(ids[1])).not.toBeNull();
    expect((await loader(reference.attachmentId))?.bytes.toString()).toBe(
      "shared reference"
    );
    expect(await Bun.file(first.chatRoot).exists()).toBe(false);
  });

  test("branch owns referenced bytes after purging its source", async () => {
    const { db, agent } = await setup();
    const source = await agent.createSession(
      "org_test",
      "web",
      "workspace_agent"
    );
    const roots = await agent.chatWorkspaces.roots(
      (await db.getSession(source))!
    );
    const { createAttachmentSaver, createAttachmentLoader } = await import(
      "./attachment-service"
    );
    const saved = await createAttachmentSaver(db, {
      ...roots,
      channel: "web",
      orgId: "org_test",
      profileId: "workspace_agent",
      sessionId: source,
    })({
      bytes: Buffer.from("preserved"),
      filename: "notes.txt",
      kind: "document",
      mediaType: "text/plain",
    });
    await replaceSessionHistory(db, source, [
      {
        content: [
          {
            attachmentId: saved.attachmentId,
            filename: "notes.txt",
            mediaType: "text/plain",
            size: 9,
            type: "document_ref",
          },
        ],
        role: "user",
      },
    ]);
    const branch = (await agent.branchSession(source, 0, "org_test"))!;
    await agent.purgeSession(source, "org_test");
    const branchRoots = await agent.chatWorkspaces.roots(
      (await db.getSession(branch.sessionId))!
    );
    const loader = createAttachmentLoader(db, {
      ...branchRoots,
      orgId: "org_test",
      profileId: "workspace_agent",
      sessionId: branch.sessionId,
    });
    expect((await loader(saved.attachmentId))?.bytes.toString()).toBe(
      "preserved"
    );
    expect(
      (await db.listAttachmentsForSession(branch.sessionId))[0].storagePath
    ).not.toContain(roots.workspaceRoot);
  });

  test("user exports include their project references and exclude other private folders", async () => {
    const { db, agent } = await setup();
    const now = new Date().toISOString();
    for (const id of ["alice", "bob"]) {
      await db.createUser({
        createdAt: now,
        email: `${id}@example.com`,
        id,
        passwordHash: "test",
        updatedAt: now,
      });
      await db.upsertOrgMember({
        createdAt: now,
        orgId: "org_test",
        role: "member",
        userId: id,
      });
    }
    const { getChatWorkspaceDir } = await import("@nakama/core");
    const owned = await agent.chatWorkspaces.create(
      "org_test",
      "project",
      "Alice",
      "alice"
    );
    const other = await agent.chatWorkspaces.create(
      "org_test",
      "project",
      "Bob",
      "bob"
    );
    await Bun.write(
      `${getChatWorkspaceDir("org_test", owned.id)}/references/own.txt`,
      "own reference"
    );
    await Bun.write(
      `${getChatWorkspaceDir("org_test", other.id)}/references/private.txt`,
      "private"
    );
    const { createNakamaUserDataExport } = await import("./data-portability");
    const { unzipSync } = await import("fflate");
    const exported = unzipSync(
      (await createNakamaUserDataExport(db, "alice")).data
    );
    expect(
      Buffer.from(
        exported[`workspaces/${owned.id}/references/own.txt`]
      ).toString()
    ).toBe("own reference");
    expect(Object.keys(exported).some((path) => path.includes(other.id))).toBe(
      false
    );
  });

  test("legacy branches recover referenced bytes and archive aliases before source deletion", async () => {
    const { db, agent } = await setup();
    await seedSession(db, "legacy-source", "workspace_agent", "org_test");
    await seedSession(db, "legacy-branch", "workspace_agent", "org_test");
    const source = (await db.getSession("legacy-source"))!;
    const roots = await agent.chatWorkspaces.roots(source);
    const { createAttachmentSaver, createAttachmentLoader } = await import(
      "./attachment-service"
    );
    const file = await createAttachmentSaver(db, {
      ...roots,
      channel: "web",
      orgId: "org_test",
      profileId: "workspace_agent",
      sessionId: source.id,
    })({
      bytes: Buffer.from("legacy bytes"),
      filename: "old.txt",
      kind: "document",
      mediaType: "text/plain",
    });
    const history: ChatMessage[] = [
      {
        content: [
          {
            attachmentId: file.attachmentId,
            filename: "old.txt",
            mediaType: "text/plain",
            size: 12,
            type: "document_ref",
          },
        ],
        role: "user",
      },
    ];
    await replaceSessionHistory(db, "legacy-branch", history);
    await archiveSessionHistory(db, "org_test", "legacy-branch", history);
    await agent.initializeChatStorage();
    await agent.initializeChatStorage();
    expect(await db.listAttachmentsForSession("legacy-branch")).toHaveLength(1);
    const [recovered] = await db.listAttachmentsForSession("legacy-branch");
    expect(
      JSON.stringify(await loadSessionHistory(db, "legacy-branch"))
    ).toContain(recovered.id);
    expect(
      JSON.stringify(await loadSessionHistory(db, "legacy-branch"))
    ).not.toContain(file.attachmentId);
    await agent.purgeSession(source.id, "org_test");
    const branchRoots = await agent.chatWorkspaces.roots(
      (await db.getSession("legacy-branch"))!
    );
    const loader = createAttachmentLoader(db, {
      ...branchRoots,
      orgId: "org_test",
      profileId: "workspace_agent",
      sessionId: "legacy-branch",
    });
    expect((await loader(file.attachmentId))?.bytes.toString()).toBe(
      "legacy bytes"
    );
    expect(
      await readFile(`${branchRoots.chatRoot}/history/archive.jsonl`, "utf8")
    ).toContain(file.attachmentId);
  });

  test("deleted agent leaves readable history and requires an explicit replacement", async () => {
    const { db, agent } = await setup();
    const id = await agent.createSession("org_test", "web", "workspace_agent");
    await replaceSessionHistory(db, id, [
      { content: "Keep this", role: "user" },
    ]);
    await db.deleteProfile("workspace_agent");
    expect((await agent.getSessionMessages(id, "org_test"))?.messages).toEqual([
      { content: "Keep this", role: "user" },
    ]);
    await expect(agent.resolveSession(id, "org_test")).rejects.toMatchObject({
      status: 409,
    });
    const now = new Date().toISOString();
    await db.upsertProfile({
      createdAt: now,
      id: "replacement",
      isDefault: true,
      isSuper: false,
      model: null,
      name: "Replacement",
      orgId: "org_test",
      systemPrompt: "",
      updatedAt: now,
    });
    const workspaceId = (await db.getSession(id))!.workspaceId;
    await agent.changeSessionAgent(id, "org_test", "replacement", {
      orgRole: "admin",
    });
    expect((await db.getSession(id))?.workspaceId).toBe(workspaceId);
    expect((await agent.resolveSession(id, "org_test"))?.getHistory()).toEqual([
      { content: "Keep this", role: "user" },
    ]);
  });

  test("leases reject deletion/export until writers actually finish; recovery is admin-only", async () => {
    const { db, agent } = await setup();
    const id = await agent.createSession("org_test", "web", "workspace_agent");
    const record = (await db.getSession(id))!;
    const { acquireWorkspaceWrite, withWorkspaceSnapshot } = await import(
      "./chat-workspace-service"
    );
    const release = acquireWorkspaceWrite(record.workspaceId!);
    await expect(agent.purgeSession(id, "org_test")).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      withWorkspaceSnapshot(null, async () => "export")
    ).rejects.toMatchObject({ status: 409 });
    release();
    expect(await agent.purgeSession(id, "org_test")).toBe(true);
    const { getProfileSoulDir } = await import("@nakama/core");
    const profileRoot = getProfileSoulDir("org_test", "workspace_agent");
    await mkdir(`${profileRoot}/artifacts`, { recursive: true });
    await Bun.write(`${profileRoot}/artifacts/legacy.txt`, "original");
    const now = new Date().toISOString();
    await db.createUser({
      createdAt: now,
      email: "legacy@example.com",
      id: "legacy-owner",
      passwordHash: "test",
      updatedAt: now,
    });
    await db.setFilePinned(
      "org_test",
      "legacy-owner",
      "workspace_agent",
      "legacy.txt",
      true
    );
    await db.createArtifactShare({
      createdAt: now,
      createdByUserId: "legacy-owner",
      filename: "legacy.txt",
      id: "legacy-share",
      mimeType: "text/plain",
      orgId: "org_test",
      profileId: "workspace_agent",
      revokedAt: null,
      sizeBytes: 8,
      sourcePath: "legacy.txt",
      storagePath: "original-snapshot",
      tokenHash: "original-token",
    });
    await agent.chatWorkspaces.recoverProfile("org_test", "workspace_agent");
    await agent.chatWorkspaces.recoverProfile("org_test", "workspace_agent");
    const workspace = (await db.listWorkspaces("org_test")).find((item) =>
      item.id.startsWith("recovered-")
    )!;
    await expect(
      agent.chatWorkspaces.require("org_test", workspace.id, {
        orgRole: "member",
      })
    ).rejects.toMatchObject({ status: 404 });
    const files = await agent.chatWorkspaces.files(workspace);
    expect(files.some((file) => file.path === "artifacts/legacy.txt")).toBe(
      true
    );
    const recovered = files.find(
      (file) => file.path === "artifacts/legacy.txt"
    )!;
    expect(
      await db.listWorkspaceFilePins("org_test", "legacy-owner", workspace.id)
    ).toEqual([recovered.id]);
    const [share] = await db.listArtifactSharesForWorkspace(workspace.id);
    expect(share.fileId).toBe(recovered.id);
    expect(share.tokenHash).toBe("original-token");
    expect(share.storagePath).toBe("original-snapshot");
    expect(await readFile(`${profileRoot}/artifacts/legacy.txt`, "utf8")).toBe(
      "original"
    );
  });
});
