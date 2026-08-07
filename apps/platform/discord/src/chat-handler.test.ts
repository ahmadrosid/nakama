import path from "node:path";
import { describe, expect, test } from "bun:test";
import type { ChatMessage } from "@nakama/core/contract";
import { DiscordAuthStore } from "./auth-store";
import { createChatHandler } from "./chat-handler";
import { SessionStore } from "./session-store";
import { ThreadStore } from "./thread-store";
import {
  createDmMessage,
  createGuildChatMessage,
  createMockClient,
  createMultiTestOrgs,
  createSlashInteraction,
  createTestOrgStore,
  withTempHome,
  writeDiscordConfigIni,
} from "./test-helpers";

async function createPairedHandler(
  homeDir: string,
  options: {
    messages?: ChatMessage[];
    onSendStream?: Parameters<typeof createMockClient>[0]["onSendStream"];
    questionnaire?: Parameters<typeof createMockClient>[0]["questionnaire"];
    orgs?: Parameters<typeof createMockClient>[0]["orgs"];
  } = {},
) {
  await writeDiscordConfigIni(homeDir, {
    botToken: "discord-bot-token",
    pairedUserIds: ["424242424242424242"],
  });

  const authStore = new DiscordAuthStore();
  await authStore.reload();
  const { client, calls } = createMockClient(options);
  const sessionStore = new SessionStore(
    path.join(homeDir, ".nakama", "discord", "chat-sessions.json"),
  );
  await sessionStore.load();
  const threadStore = new ThreadStore(
    path.join(homeDir, ".nakama", "discord", "chat-threads.json"),
  );
  await threadStore.load();
  const orgStore = createTestOrgStore(homeDir);
  await orgStore.load();
  const handlers = createChatHandler({
    client,
    config: { botToken: "discord-bot-token", profileId: "default" },
    authStore,
    sessionStore,
    threadStore,
    orgStore,
  });

  return { ...handlers, client, calls, sessionStore, threadStore, orgStore };
}

describe("createChatHandler artifact delivery", () => {
  const metaJson = JSON.stringify({
    mimeType: "text/markdown",
    savedAt: "2026-07-13T10:00:00.000Z",
    sizeBytes: 42,
  });

  const artifactMessages: ChatMessage[] = [
    { role: "user", content: "save report" },
    {
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "tool_1",
          name: "write_file",
          arguments: { path: "artifacts/report.md", content: "# Report" },
        },
        {
          id: "tool_2",
          name: "write_file",
          arguments: { path: "artifacts/report.md.nakama-meta.json", content: metaJson },
        },
      ],
    },
    {
      role: "tool",
      toolCallId: "tool_1",
      name: "write_file",
      content: JSON.stringify({
        path: "/home/.nakama/orgs/org/profiles/default/artifacts/report.md",
        bytesWritten: 8,
      }),
    },
    {
      role: "tool",
      toolCallId: "tool_2",
      name: "write_file",
      content: JSON.stringify({
        path: "/home/.nakama/orgs/org/profiles/default/artifacts/report.md.nakama-meta.json",
        bytesWritten: metaJson.length,
      }),
    },
    { role: "assistant", content: "Saved the report." },
  ];

  test("auto-uploads a small artifact after a paired save-artifact turn", async () => {
    await withTempHome(async (homeDir) => {
      const { handleMessage, calls, sessionStore } = await createPairedHandler(homeDir, {
        messages: artifactMessages,
      });
      sessionStore.set("dm_channel_1", {
        sessionId: "session_test",
        profileId: "default",
        updatedAt: new Date().toISOString(),
      });
      await sessionStore.save();

      const dm = createDmMessage({
        userId: "424242424242424242",
        content: "thanks",
      });
      await handleMessage(dm.message);

      expect(calls.publishProfileArtifactShare).toBe(1);
      expect(calls.readProfileArtifactContent).toBe(1);
      expect(dm.fileSendCalls).toBe(1);
      expect(dm.sentMessages.some((reply) => reply.includes("https://app.example/s/tok_test"))).toBe(
        false,
      );
    });
  });

  test("falls back to a share link when the artifact exceeds the Discord attachment cap", async () => {
    await withTempHome(async (homeDir) => {
      const oversizedMeta = JSON.stringify({
        mimeType: "video/mp4",
        savedAt: "2026-07-13T10:00:00.000Z",
        sizeBytes: 9 * 1024 * 1024,
      });
      const oversizedMessages: ChatMessage[] = [
        { role: "user", content: "save video" },
        {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "tool_1",
              name: "write_file",
              arguments: { path: "artifacts/clip.mp4", content: "binary" },
            },
            {
              id: "tool_2",
              name: "write_file",
              arguments: { path: "artifacts/clip.mp4.nakama-meta.json", content: oversizedMeta },
            },
          ],
        },
        {
          role: "tool",
          toolCallId: "tool_1",
          name: "write_file",
          content: JSON.stringify({
            path: "/home/.nakama/orgs/org/profiles/default/artifacts/clip.mp4",
            bytesWritten: 9 * 1024 * 1024,
          }),
        },
        {
          role: "tool",
          toolCallId: "tool_2",
          name: "write_file",
          content: JSON.stringify({
            path: "/home/.nakama/orgs/org/profiles/default/artifacts/clip.mp4.nakama-meta.json",
            bytesWritten: oversizedMeta.length,
          }),
        },
        { role: "assistant", content: "Saved the clip." },
      ];

      const { handleMessage, calls, sessionStore } = await createPairedHandler(homeDir, {
        messages: oversizedMessages,
      });
      sessionStore.set("dm_channel_1", {
        sessionId: "session_test",
        profileId: "default",
        updatedAt: new Date().toISOString(),
      });
      await sessionStore.save();

      const dm = createDmMessage({
        userId: "424242424242424242",
        content: "thanks",
      });
      await handleMessage(dm.message);

      expect(calls.publishProfileArtifactShare).toBe(1);
      expect(calls.readProfileArtifactContent).toBe(0);
      expect(dm.fileSendCalls).toBe(0);
      expect(dm.sentMessages.some((reply) => reply.includes("https://app.example/s/tok_test"))).toBe(
        true,
      );
    });
  });

  test("does not publish when the turn has no sidecar pair", async () => {
    await withTempHome(async (homeDir) => {
      const { handleMessage, calls, sessionStore } = await createPairedHandler(homeDir, {
        messages: [
          { role: "user", content: "save" },
          {
            role: "assistant",
            content: "",
            toolCalls: [
              {
                id: "tool_1",
                name: "write_file",
                arguments: { path: "artifacts/draft.md", content: "draft" },
              },
            ],
          },
          {
            role: "tool",
            toolCallId: "tool_1",
            name: "write_file",
            content: JSON.stringify({
              path: "/home/.nakama/orgs/org/profiles/default/artifacts/draft.md",
              bytesWritten: 5,
            }),
          },
        ],
      });
      sessionStore.set("dm_channel_1", {
        sessionId: "session_test",
        profileId: "default",
        updatedAt: new Date().toISOString(),
      });
      await sessionStore.save();

      const { message, sentMessages } = createDmMessage({
        userId: "424242424242424242",
        content: "thanks",
      });
      await handleMessage(message);

      expect(calls.publishProfileArtifactShare).toBe(0);
      expect(sentMessages.some((reply) => reply.includes("/s/"))).toBe(false);
    });
  });

  test("sends a document when the user asks to attach a saved artifact", async () => {
    await withTempHome(async (homeDir) => {
      const { handleMessage, calls, sessionStore } = await createPairedHandler(homeDir);
      sessionStore.set("dm_channel_1", {
        sessionId: "session_test",
        profileId: "default",
        updatedAt: new Date().toISOString(),
        deliverableArtifacts: [
          {
            filename: "report.md",
            path: "report.md",
            mimeType: "text/markdown",
            sizeBytes: 42,
            savedAt: "2026-07-13T10:00:00.000Z",
            shareUrl: "https://app.example/s/tok_test",
            sharePath: "/s/tok_test",
          },
        ],
      });
      await sessionStore.save();

      const dm = createDmMessage({
        userId: "424242424242424242",
        content: "send me the file",
      });
      await handleMessage(dm.message);

      expect(dm.fileSendCalls).toBe(1);
    });
  });
});

describe("createChatHandler early ack", () => {
  async function setupAckHandler(
    homeDir: string,
    onSendStream: NonNullable<Parameters<typeof createMockClient>[0]>["onSendStream"],
  ) {
    await writeDiscordConfigIni(homeDir, {
      botToken: "discord-bot-token",
      pairedUserIds: ["424242424242424242"],
    });

    const authStore = new DiscordAuthStore();
    await authStore.reload();
    const { client } = createMockClient({ onSendStream });
    const sessionStore = new SessionStore(
      path.join(homeDir, ".nakama", "discord", "chat-sessions.json"),
    );
    await sessionStore.load();
    sessionStore.set("dm_channel_1", {
      sessionId: "session_test",
      profileId: "default",
      updatedAt: new Date().toISOString(),
    });
    await sessionStore.save();
    const orgStore = createTestOrgStore(homeDir);
    await orgStore.load();
    return createChatHandler({
      client,
      config: { botToken: "discord-bot-token", profileId: "default" },
      authStore,
      sessionStore,
      orgStore,
    });
  }

  test("posts the streamed status before tools, then the final outcome", async () => {
    await withTempHome(async (homeDir) => {
      const { handleMessage } = await setupAckHandler(homeDir, async (_input, handlers) => {
        handlers?.onChunk("Checking the repo first.");
        handlers?.onToolStart?.({
          toolCallId: "tool_1",
          tool: "bash",
          input: { command: "ls" },
        });
        handlers?.onToolEnd?.({
          toolCallId: "tool_1",
          tool: "bash",
          result: { exitCode: 0 },
        });
        handlers?.onChunk("Done — branch is clean.");
        return "Done — branch is clean.";
      });

      const dm = createDmMessage({
        userId: "424242424242424242",
        content: "check the repo",
      });
      await handleMessage(dm.message);

      expect(dm.sentMessages[0]).toBe("Checking the repo first.");
      expect(dm.sentMessages.at(-1)).toBe("Done — branch is clean.");
      expect(dm.sentMessages).toHaveLength(2);
    });
  });

  test("posts a fallback ack when tools start with no streamed text", async () => {
    await withTempHome(async (homeDir) => {
      const { handleMessage } = await setupAckHandler(homeDir, async (_input, handlers) => {
        handlers?.onToolStart?.({
          toolCallId: "tool_1",
          tool: "bash",
          input: { command: "ls" },
        });
        handlers?.onToolEnd?.({
          toolCallId: "tool_1",
          tool: "bash",
          result: { exitCode: 0 },
        });
        return "All set.";
      });

      const dm = createDmMessage({
        userId: "424242424242424242",
        content: "do the thing",
      });
      await handleMessage(dm.message);

      expect(dm.sentMessages[0]).toBe("On it.");
      expect(dm.sentMessages.at(-1)).toBe("All set.");
    });
  });

  test("does not post an early ack when the turn uses no tools", async () => {
    await withTempHome(async (homeDir) => {
      const { handleMessage } = await setupAckHandler(homeDir, async (_input, handlers) => {
        handlers?.onChunk("Hello.");
        return "Hello.";
      });

      const dm = createDmMessage({
        userId: "424242424242424242",
        content: "hi",
      });
      await handleMessage(dm.message);

      expect(dm.sentMessages).toEqual(["Hello."]);
    });
  });
});

describe("createChatHandler questionnaire delivery", () => {
  const questionnaire = {
    id: "qset_1",
    title: "Need input",
    questions: [
      {
        id: "how-to-run",
        prompt: "How should I run this?",
        choices: [
          { id: "playwright", label: "Build Playwright e2e" },
          { id: "manual", label: "Manual steps only" },
        ],
        allowCustomAnswer: true,
      },
    ],
  };

  test("posts the questionnaire when ask_user_question fires and skips empty reply", async () => {
    await withTempHome(async (homeDir) => {
      const { handleMessage } = await createPairedHandler(homeDir, {
        onSendStream: async (_input, handlers) => {
          handlers?.onQuestionnaireUpdated?.(questionnaire);
          return "";
        },
      });
      const { message, sentMessages } = createDmMessage({
        userId: "424242424242424242",
        content: "help me ship this",
      });
      await handleMessage(message);

      expect(sentMessages.some((reply) => reply.includes("Need input"))).toBe(true);
      expect(sentMessages.some((reply) => reply.includes("a) Build Playwright e2e"))).toBe(true);
      expect(sentMessages.some((reply) => reply.includes("(empty reply)"))).toBe(false);
    });
  });

  test("forwards the next Discord reply to the agent without parsing questionnaire answers", async () => {
    await withTempHome(async (homeDir) => {
      const streamedInputs: unknown[] = [];
      const { handleMessage, sessionStore } = await createPairedHandler(homeDir, {
        questionnaire,
        onSendStream: async (input) => {
          streamedInputs.push(input);
          return "Got it.";
        },
      });
      sessionStore.set("dm_channel_1", {
        sessionId: "session_test",
        profileId: "default",
        updatedAt: new Date().toISOString(),
      });
      await sessionStore.save();

      const { message, sentMessages } = createDmMessage({
        userId: "424242424242424242",
        content: "a",
      });
      await handleMessage(message);

      expect(streamedInputs[0]).toEqual({ message: "a" });
      expect(sentMessages).toContain("Got it.");
      expect(sentMessages.some((reply) => reply.includes("Couldn't parse that"))).toBe(false);
    });
  });
});

describe("createChatHandler guild thread routing", () => {
  test("mention in a guild channel creates a thread and replies inside it", async () => {
    await withTempHome(async (homeDir) => {
      const streamedInputs: unknown[] = [];
      const { handleMessage, threadStore } = await createPairedHandler(homeDir, {
        onSendStream: async (input) => {
          streamedInputs.push(input);
          return "Thread reply";
        },
      });

      const guild = createGuildChatMessage({
        content: "<@bot_id> summarize this",
        mentionsBot: true,
      });
      await handleMessage(guild.message);

      expect(guild.startThreadCalls).toBe(1);
      expect(guild.lastThreadName).toBe("summarize this");
      expect(guild.threadSentMessages).toContain("Thread reply");
      expect(guild.channelSentMessages).not.toContain("Thread reply");
      expect(threadStore.get("g:guild_channel_1:u:424242424242424242")).toBe(
        guild.createdThreadId,
      );
      expect(streamedInputs[0]).toEqual({ message: "summarize this" });
    });
  });

  test("second mention in the same channel creates a distinct thread", async () => {
    await withTempHome(async (homeDir) => {
      const streamedInputs: unknown[] = [];
      const { handleMessage, threadStore, sessionStore } = await createPairedHandler(homeDir, {
        onSendStream: async (input) => {
          streamedInputs.push(input);
          return "Again";
        },
      });

      const first = createGuildChatMessage({
        content: "<@bot_id> first question",
        mentionsBot: true,
      });
      await handleMessage(first.message);
      const firstThreadId = first.createdThreadId;
      expect(firstThreadId).toBeTruthy();
      expect(threadStore.get("g:guild_channel_1:u:424242424242424242")).toBe(firstThreadId);
      expect(sessionStore.get(`g:guild_channel_1:t:${firstThreadId}`)).toBeTruthy();

      const second = createGuildChatMessage({
        content: "<@bot_id> new topic",
        mentionsBot: true,
      });
      await handleMessage(second.message);
      const secondThreadId = second.createdThreadId;

      expect(second.startThreadCalls).toBe(1);
      expect(secondThreadId).toBeTruthy();
      expect(secondThreadId).not.toBe(firstThreadId);
      expect(threadStore.list("g:guild_channel_1:u:424242424242424242")).toEqual([
        firstThreadId!,
        secondThreadId!,
      ]);
      expect(threadStore.hasThreadId(firstThreadId!)).toBe(true);
      expect(threadStore.hasThreadId(secondThreadId!)).toBe(true);
      expect(second.threadSentMessages).toContain("Again");
      expect(streamedInputs).toHaveLength(2);

      // Old thread session remains independent of the new one.
      expect(sessionStore.get(`g:guild_channel_1:t:${firstThreadId}`)?.sessionId).toBe(
        "session_test",
      );
      expect(sessionStore.get(`g:guild_channel_1:t:${secondThreadId}`)?.sessionId).toBe(
        "session_test",
      );
    });
  });

  test("old bot-owned thread still accepts follow-ups after a newer parent mention", async () => {
    await withTempHome(async (homeDir) => {
      const streamedByKey: string[] = [];
      const { handleMessage, threadStore } = await createPairedHandler(homeDir, {
        onSendStream: async (input) => {
          streamedByKey.push(String((input as { message?: string }).message ?? ""));
          return "Follow-up ok";
        },
      });

      const first = createGuildChatMessage({
        content: "<@bot_id> topic one",
        mentionsBot: true,
      });
      await handleMessage(first.message);
      const oldThreadId = first.createdThreadId!;

      const second = createGuildChatMessage({
        content: "<@bot_id> topic two",
        mentionsBot: true,
      });
      await handleMessage(second.message);

      const followUp = createGuildChatMessage({
        content: "continue topic one",
        inThread: true,
        threadId: oldThreadId,
        parentId: "guild_channel_1",
      });
      await handleMessage(followUp.message);

      expect(threadStore.hasThreadId(oldThreadId)).toBe(true);
      expect(followUp.threadSentMessages).toContain("Follow-up ok");
      expect(streamedByKey.at(-1)).toBe("continue topic one");
    });
  });

  test("concurrent parent mentions run in parallel on distinct threads", async () => {
    await withTempHome(async (homeDir) => {
      let releaseFirst!: () => void;
      const firstGate = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      let firstStarted = false;
      const startedOrder: string[] = [];

      const { handleMessage, threadStore } = await createPairedHandler(homeDir, {
        onSendStream: async (input) => {
          const text = String((input as { message?: string }).message ?? "");
          startedOrder.push(text);
          if (text === "slow") {
            firstStarted = true;
            await firstGate;
            return "Slow done";
          }
          return "Fast done";
        },
      });

      const slow = createGuildChatMessage({
        content: "<@bot_id> slow",
        mentionsBot: true,
      });
      const fast = createGuildChatMessage({
        content: "<@bot_id> fast",
        mentionsBot: true,
      });

      const slowPromise = handleMessage(slow.message);
      await Bun.sleep(20);
      expect(firstStarted).toBe(true);

      const fastPromise = handleMessage(fast.message);
      await Bun.sleep(20);
      // Fast should start while slow still holds its own thread lock.
      expect(startedOrder).toContain("fast");

      releaseFirst();
      await Promise.all([slowPromise, fastPromise]);

      expect(slow.startThreadCalls).toBe(1);
      expect(fast.startThreadCalls).toBe(1);
      expect(slow.createdThreadId).not.toBe(fast.createdThreadId);
      expect(threadStore.list("g:guild_channel_1:u:424242424242424242")).toHaveLength(2);
      expect(slow.threadSentMessages).toContain("Slow done");
      expect(fast.threadSentMessages).toContain("Fast done");
    });
  });

  test("/new from a parent channel creates a fresh Discord thread", async () => {
    await withTempHome(async (homeDir) => {
      const { handleSlashCommand, threadStore, sessionStore } = await createPairedHandler(homeDir);

      threadStore.set("g:guild_channel_1:u:424242424242424242", "thread_old");
      await threadStore.save();

      const newCmd = createSlashInteraction({
        commandName: "new",
        channelId: "guild_channel_1",
      });
      await handleSlashCommand(newCmd.interaction);

      expect(newCmd.startThreadCalls).toBe(1);
      expect(newCmd.createdThreadId).toBeTruthy();
      expect(newCmd.replies.some((text) => text.includes(`<#${newCmd.createdThreadId}>`))).toBe(
        true,
      );
      expect(threadStore.hasThreadId("thread_old")).toBe(true);
      expect(threadStore.hasThreadId(newCmd.createdThreadId!)).toBe(true);
      expect(sessionStore.get(`g:guild_channel_1:t:${newCmd.createdThreadId}`)).toBeTruthy();
    });
  });

  test("thread message without mention is answered in a bot-owned thread", async () => {
    await withTempHome(async (homeDir) => {
      const streamedInputs: unknown[] = [];
      const { handleMessage, threadStore } = await createPairedHandler(homeDir, {
        onSendStream: async (input) => {
          streamedInputs.push(input);
          return "In-thread answer";
        },
      });

      threadStore.set("g:guild_channel_1:u:424242424242424242", "thread_42");
      await threadStore.save();

      const guild = createGuildChatMessage({
        content: "keep going",
        inThread: true,
        threadId: "thread_42",
        parentId: "guild_channel_1",
      });
      await handleMessage(guild.message);

      expect(guild.startThreadCalls).toBe(0);
      expect(guild.threadSentMessages).toContain("In-thread answer");
      expect(streamedInputs[0]).toEqual({ message: "keep going" });
    });
  });

  test("ignores messages in threads the agent did not start", async () => {
    await withTempHome(async (homeDir) => {
      const streamedInputs: unknown[] = [];
      const { handleMessage } = await createPairedHandler(homeDir, {
        onSendStream: async (input) => {
          streamedInputs.push(input);
          return "Should not reply";
        },
      });

      const guild = createGuildChatMessage({
        content: "<@bot_id> please join this thread",
        mentionsBot: true,
        inThread: true,
        threadId: "user_thread_9",
        parentId: "guild_channel_1",
      });
      await handleMessage(guild.message);

      expect(guild.startThreadCalls).toBe(0);
      expect(guild.threadSentMessages).toHaveLength(0);
      expect(guild.channelSentMessages).toHaveLength(0);
      expect(streamedInputs).toHaveLength(0);
    });
  });

  test("thread messages reuse the parent channel org selection", async () => {
    await withTempHome(async (homeDir) => {
      const streamedInputs: unknown[] = [];
      const { handleMessage, orgStore, threadStore } = await createPairedHandler(homeDir, {
        orgs: createMultiTestOrgs(),
        onSendStream: async (input) => {
          streamedInputs.push(input);
          return "In-thread answer";
        },
      });

      orgStore.set("g:guild_channel_1", "org_a");
      await orgStore.save();
      threadStore.set("g:guild_channel_1:u:424242424242424242", "thread_42");
      await threadStore.save();

      const guild = createGuildChatMessage({
        content: "keep going",
        inThread: true,
        threadId: "thread_42",
        parentId: "guild_channel_1",
      });
      await handleMessage(guild.message);

      expect(guild.threadSentMessages.some((text) => text.includes("Choose an organization"))).toBe(
        false,
      );
      expect(guild.threadSentMessages).toContain("In-thread answer");
      expect(streamedInputs).toHaveLength(1);
      expect(orgStore.get("g:thread_42")).toBeUndefined();
      expect(orgStore.get("g:guild_channel_1")?.orgId).toBe("org_a");
    });
  });

  test("slash commands in threads reuse the parent channel org selection", async () => {
    await withTempHome(async (homeDir) => {
      const { handleSlashCommand, orgStore } = await createPairedHandler(homeDir, {
        orgs: createMultiTestOrgs(),
      });

      orgStore.set("g:guild_channel_1", "org_b");
      await orgStore.save();

      const clearCmd = createSlashInteraction({
        commandName: "clear",
        inThread: true,
        threadId: "thread_1",
        parentId: "guild_channel_1",
      });
      await handleSlashCommand(clearCmd.interaction);

      expect(clearCmd.replies.some((text) => text.includes("Choose an organization"))).toBe(false);
      expect(clearCmd.replies).toContain("History cleared.");
      expect(orgStore.get("g:thread_1")).toBeUndefined();
    });
  });

  test("thread creation failure falls back to channel reply", async () => {
    await withTempHome(async (homeDir) => {
      const { handleMessage } = await createPairedHandler(homeDir, {
        onSendStream: async (input) => {
          // Fallback path still uses the public-channel prefix.
          expect(input).toEqual({
            message:
              "[Discord channel — your reply is visible to everyone in this channel.]\nhello",
          });
          return "Channel fallback";
        },
      });

      const guild = createGuildChatMessage({
        content: "<@bot_id> hello",
        mentionsBot: true,
        startThreadError: new Error("Missing Permissions"),
      });
      await handleMessage(guild.message);

      expect(guild.startThreadCalls).toBe(1);
      expect(guild.channelSentMessages).toContain("Channel fallback");
      expect(guild.threadSentMessages).toHaveLength(0);
    });
  });

  test("slash commands in threads still clear and start new sessions", async () => {
    await withTempHome(async (homeDir) => {
      const { handleSlashCommand, sessionStore } = await createPairedHandler(homeDir);
      const conversationKey = "g:guild_channel_1:t:thread_1";
      sessionStore.set(conversationKey, {
        sessionId: "session_test",
        profileId: "default",
        updatedAt: new Date().toISOString(),
      });
      await sessionStore.save();

      const clearCmd = createSlashInteraction({
        commandName: "clear",
        inThread: true,
        threadId: "thread_1",
        parentId: "guild_channel_1",
      });
      await handleSlashCommand(clearCmd.interaction);
      expect(clearCmd.replies).toContain("History cleared.");

      const newCmd = createSlashInteraction({
        commandName: "new",
        inThread: true,
        threadId: "thread_1",
        parentId: "guild_channel_1",
      });
      await handleSlashCommand(newCmd.interaction);
      expect(newCmd.replies).toContain("Started a new conversation.");

      const stopCmd = createSlashInteraction({
        commandName: "stop",
        inThread: true,
        threadId: "thread_1",
        parentId: "guild_channel_1",
      });
      await handleSlashCommand(stopCmd.interaction);
      expect(stopCmd.replies).toContain("Nothing to stop.");
    });
  });

  test("close archives a bot-owned thread and clears the mapping", async () => {
    await withTempHome(async (homeDir) => {
      const { handleSlashCommand, threadStore } = await createPairedHandler(homeDir);
      threadStore.set("g:guild_channel_1:u:424242424242424242", "thread_1");
      await threadStore.save();

      const closeCmd = createSlashInteraction({
        commandName: "close",
        inThread: true,
        threadId: "thread_1",
        parentId: "guild_channel_1",
      });
      await handleSlashCommand(closeCmd.interaction);

      expect(closeCmd.replies).toContain("Thread closed.");
      expect((closeCmd.interaction.channel as { archived?: boolean }).archived).toBe(true);
      expect(threadStore.get("g:guild_channel_1:u:424242424242424242")).toBeUndefined();
      expect(threadStore.hasThreadId("thread_1")).toBe(false);
    });
  });

  test("close rejects non-thread channels and foreign threads", async () => {
    await withTempHome(async (homeDir) => {
      const { handleSlashCommand, threadStore } = await createPairedHandler(homeDir);
      threadStore.set("g:guild_channel_1:u:424242424242424242", "thread_owned");
      await threadStore.save();

      const channelClose = createSlashInteraction({
        commandName: "close",
        channelId: "guild_channel_1",
      });
      await handleSlashCommand(channelClose.interaction);
      expect(channelClose.replies).toContain("Use /close inside a bot conversation thread.");

      const foreignClose = createSlashInteraction({
        commandName: "close",
        inThread: true,
        threadId: "user_thread_9",
        parentId: "guild_channel_1",
      });
      await handleSlashCommand(foreignClose.interaction);
      expect(foreignClose.replies).toContain("I can only close threads I started.");
      expect(threadStore.hasThreadId("thread_owned")).toBe(true);
    });
  });
});
