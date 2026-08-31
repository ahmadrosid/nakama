import { afterEach, describe, expect, spyOn, test } from "bun:test";
import path from "node:path";
import { ChannelSessionStore } from "@nakama/core/channel-session-store";
import type { ChatMessage } from "@nakama/core/contract";
import { loadDiscordConfigFile } from "@nakama/core/discord-config";
import { DiscordAuthStore } from "./auth-store";
import {
  chatLockOptions,
  createChatHandler,
  getChatLockCountForTests,
  resetChatLocksForTests,
  seedChatLockForTests,
  withChatLock,
} from "./chat-handler";
import { TOO_MANY_IMAGES_REPLY, UNSUPPORTED_ATTACHMENT_REPLY } from "./images";
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
import { ThreadStore } from "./thread-store";

afterEach(() => {
  resetChatLocksForTests();
  chatLockOptions.waitMs = 15 * 60 * 1000;
});

/**
 * Same shape as the telegram suite's helper (chat-handler.test.ts). Prefer real
 * intervals over a tight spin: under CI's concurrent workspace load, session
 * I/O can take tens of ms before sendStream runs, and a 1ms poll competes with
 * the very work it is waiting for.
 */
async function waitForCondition(
  condition: () => boolean,
  message: string,
  options: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 2000;
  const intervalMs = options.intervalMs ?? 10;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (condition()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(message);
}

async function createPairedHandler(
  homeDir: string,
  options: {
    messages?: ChatMessage[];
    onSendStream?: Parameters<typeof createMockClient>[0]["onSendStream"];
    questionnaire?: Parameters<typeof createMockClient>[0]["questionnaire"];
    orgs?: Parameters<typeof createMockClient>[0]["orgs"];
    profiles?: Parameters<typeof createMockClient>[0]["profiles"];
    listedArtifacts?: Parameters<typeof createMockClient>[0]["listedArtifacts"];
    artifactContentBytes?: Parameters<
      typeof createMockClient
    >[0]["artifactContentBytes"];
    configProfileId?: string;
    pairedUserIds?: string[];
    allowedUserIds?: string[];
  } = {}
) {
  await writeDiscordConfigIni(homeDir, {
    allowedUserIds: options.allowedUserIds ?? [],
    botToken: "discord-bot-token",
    pairedUserIds: options.pairedUserIds ?? ["424242424242424242"],
  });

  const authStore = new DiscordAuthStore();
  await authStore.reload();
  const { client, calls, createdSessionProfileIds } = createMockClient(options);
  const sessionStore = new ChannelSessionStore(
    path.join(homeDir, ".nakama", "discord", "chat-sessions.json")
  );
  await sessionStore.load();
  const threadStore = new ThreadStore(
    path.join(homeDir, ".nakama", "discord", "chat-threads.json")
  );
  await threadStore.load();
  const orgStore = createTestOrgStore(homeDir);
  await orgStore.load();
  const handlers = createChatHandler({
    authStore,
    client,
    config: {
      botToken: "discord-bot-token",
      profileId: options.configProfileId ?? "default",
    },
    orgStore,
    sessionStore,
    threadStore,
  });

  return {
    ...handlers,
    calls,
    client,
    createdSessionProfileIds,
    orgStore,
    sessionStore,
    threadStore,
  };
}

describe("createChatHandler logging", () => {
  test("logs message metadata without private content", async () => {
    await withTempHome(async (homeDir) => {
      const privateMessage = "private 🔒 message";
      const log = spyOn(console, "log").mockImplementation(() => {});

      try {
        const { handleMessage } = await createPairedHandler(homeDir);
        const dm = createDmMessage({ content: privateMessage });

        await handleMessage(dm.message);

        const output = log.mock.calls
          .map((args) => args.map(String).join(" "))
          .join("\n");
        expect(output).toContain(
          `textBytes=${Buffer.byteLength(privateMessage, "utf8")}`
        );
        expect(output).not.toContain(privateMessage);
        expect(output).not.toContain(dm.message.author.id);
        expect(output).not.toContain("dm_channel_1");
        expect(output).not.toContain("channelId=");
      } finally {
        log.mockRestore();
      }
    });
  });
});

describe("createChatHandler artifact delivery", () => {
  const metaJson = JSON.stringify({
    mimeType: "text/markdown",
    savedAt: "2026-07-13T10:00:00.000Z",
    sizeBytes: 42,
  });

  const artifactMessages: ChatMessage[] = [
    { content: "save report", role: "user" },
    {
      content: "",
      role: "assistant",
      toolCalls: [
        {
          arguments: { content: "# Report", path: "artifacts/report.md" },
          id: "tool_1",
          name: "write_file",
        },
        {
          arguments: {
            content: metaJson,
            path: "artifacts/report.md.nakama-meta.json",
          },
          id: "tool_2",
          name: "write_file",
        },
      ],
    },
    {
      content: JSON.stringify({
        bytesWritten: 8,
        path: "/home/.nakama/orgs/org/profiles/default/artifacts/report.md",
      }),
      name: "write_file",
      role: "tool",
      toolCallId: "tool_1",
    },
    {
      content: JSON.stringify({
        bytesWritten: metaJson.length,
        path: "/home/.nakama/orgs/org/profiles/default/artifacts/report.md.nakama-meta.json",
      }),
      name: "write_file",
      role: "tool",
      toolCallId: "tool_2",
    },
    { content: "Saved the report.", role: "assistant" },
  ];

  test("auto-uploads a small artifact after a paired save-artifact turn", async () => {
    await withTempHome(async (homeDir) => {
      const { handleMessage, calls, sessionStore } = await createPairedHandler(
        homeDir,
        {
          messages: artifactMessages,
        }
      );
      sessionStore.set("dm_channel_1", {
        profileId: "default",
        sessionId: "session_test",
        updatedAt: new Date().toISOString(),
      });
      await sessionStore.save();

      const dm = createDmMessage({
        content: "thanks",
        userId: "424242424242424242",
      });
      await handleMessage(dm.message);

      expect(calls.publishProfileArtifactShare).toBe(1);
      expect(calls.readProfileArtifactContent).toBe(1);
      expect(dm.fileSendCalls).toBe(1);
      expect(
        dm.sentMessages.some((reply) =>
          reply.includes("https://app.example/s/tok_test")
        )
      ).toBe(true);
    });
  });

  test("auto-uploads a PDF artifact after a paired save-artifact turn", async () => {
    await withTempHome(async (homeDir) => {
      const pdfMeta = JSON.stringify({
        mimeType: "application/pdf",
        savedAt: "2026-07-13T10:00:00.000Z",
        sizeBytes: 270_000,
      });
      const pdfMessages: ChatMessage[] = [
        { content: "save pitch deck", role: "user" },
        {
          content: "",
          role: "assistant",
          toolCalls: [
            {
              arguments: {
                content: "%PDF-1.4",
                path: "artifacts/nakama-pitch-deck.pdf",
              },
              id: "tool_1",
              name: "write_file",
            },
            {
              arguments: {
                content: pdfMeta,
                path: "artifacts/nakama-pitch-deck.pdf.nakama-meta.json",
              },
              id: "tool_2",
              name: "write_file",
            },
          ],
        },
        {
          content: JSON.stringify({
            bytesWritten: 270_000,
            path: "/home/.nakama/orgs/org/profiles/default/artifacts/nakama-pitch-deck.pdf",
          }),
          name: "write_file",
          role: "tool",
          toolCallId: "tool_1",
        },
        {
          content: JSON.stringify({
            bytesWritten: pdfMeta.length,
            path: "/home/.nakama/orgs/org/profiles/default/artifacts/nakama-pitch-deck.pdf.nakama-meta.json",
          }),
          name: "write_file",
          role: "tool",
          toolCallId: "tool_2",
        },
        { content: "Saved the pitch deck.", role: "assistant" },
      ];

      const { handleMessage, calls, sessionStore } = await createPairedHandler(
        homeDir,
        {
          artifactContentBytes: new TextEncoder().encode("%PDF-1.4"),
          messages: pdfMessages,
        }
      );
      sessionStore.set("dm_channel_1", {
        profileId: "default",
        sessionId: "session_test",
        updatedAt: new Date().toISOString(),
      });
      await sessionStore.save();

      const dm = createDmMessage({
        content: "thanks",
        userId: "424242424242424242",
      });
      await handleMessage(dm.message);

      expect(calls.publishProfileArtifactShare).toBe(1);
      expect(calls.readProfileArtifactContent).toBe(1);
      expect(dm.fileSendCalls).toBe(1);
    });
  });

  test("auto-uploads a CSV artifact after a paired save-artifact turn", async () => {
    await withTempHome(async (homeDir) => {
      const csvMeta = JSON.stringify({
        mimeType: "text/csv",
        savedAt: "2026-07-13T10:00:00.000Z",
        sizeBytes: 24,
      });
      const csvMessages: ChatMessage[] = [
        { content: "export csv", role: "user" },
        {
          content: "",
          role: "assistant",
          toolCalls: [
            {
              arguments: {
                content: "a,b\n1,2\n",
                path: "artifacts/export.csv",
              },
              id: "tool_1",
              name: "write_file",
            },
            {
              arguments: {
                content: csvMeta,
                path: "artifacts/export.csv.nakama-meta.json",
              },
              id: "tool_2",
              name: "write_file",
            },
          ],
        },
        {
          content: JSON.stringify({
            bytesWritten: 8,
            path: "/home/.nakama/orgs/org/profiles/default/artifacts/export.csv",
          }),
          name: "write_file",
          role: "tool",
          toolCallId: "tool_1",
        },
        {
          content: JSON.stringify({
            bytesWritten: csvMeta.length,
            path: "/home/.nakama/orgs/org/profiles/default/artifacts/export.csv.nakama-meta.json",
          }),
          name: "write_file",
          role: "tool",
          toolCallId: "tool_2",
        },
        { content: "Saved the CSV.", role: "assistant" },
      ];

      const { handleMessage, calls, sessionStore } = await createPairedHandler(
        homeDir,
        {
          artifactContentBytes: new TextEncoder().encode("a,b\n1,2\n"),
          messages: csvMessages,
        }
      );
      sessionStore.set("dm_channel_1", {
        profileId: "default",
        sessionId: "session_test",
        updatedAt: new Date().toISOString(),
      });
      await sessionStore.save();

      const dm = createDmMessage({
        content: "thanks",
        userId: "424242424242424242",
      });
      await handleMessage(dm.message);

      expect(calls.publishProfileArtifactShare).toBe(1);
      expect(calls.readProfileArtifactContent).toBe(1);
      expect(dm.fileSendCalls).toBe(1);
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
        { content: "save video", role: "user" },
        {
          content: "",
          role: "assistant",
          toolCalls: [
            {
              arguments: { content: "binary", path: "artifacts/clip.mp4" },
              id: "tool_1",
              name: "write_file",
            },
            {
              arguments: {
                content: oversizedMeta,
                path: "artifacts/clip.mp4.nakama-meta.json",
              },
              id: "tool_2",
              name: "write_file",
            },
          ],
        },
        {
          content: JSON.stringify({
            bytesWritten: 9 * 1024 * 1024,
            path: "/home/.nakama/orgs/org/profiles/default/artifacts/clip.mp4",
          }),
          name: "write_file",
          role: "tool",
          toolCallId: "tool_1",
        },
        {
          content: JSON.stringify({
            bytesWritten: oversizedMeta.length,
            path: "/home/.nakama/orgs/org/profiles/default/artifacts/clip.mp4.nakama-meta.json",
          }),
          name: "write_file",
          role: "tool",
          toolCallId: "tool_2",
        },
        { content: "Saved the clip.", role: "assistant" },
      ];

      const { handleMessage, calls, sessionStore } = await createPairedHandler(
        homeDir,
        {
          messages: oversizedMessages,
        }
      );
      sessionStore.set("dm_channel_1", {
        profileId: "default",
        sessionId: "session_test",
        updatedAt: new Date().toISOString(),
      });
      await sessionStore.save();

      const dm = createDmMessage({
        content: "thanks",
        userId: "424242424242424242",
      });
      await handleMessage(dm.message);

      expect(calls.publishProfileArtifactShare).toBe(1);
      expect(calls.readProfileArtifactContent).toBe(0);
      expect(dm.fileSendCalls).toBe(0);
      expect(
        dm.sentMessages.some((reply) =>
          reply.includes("https://app.example/s/tok_test")
        )
      ).toBe(true);
    });
  });

  test("does not publish when the turn has no sidecar pair", async () => {
    await withTempHome(async (homeDir) => {
      const { handleMessage, calls, sessionStore } = await createPairedHandler(
        homeDir,
        {
          messages: [
            { content: "save", role: "user" },
            {
              content: "",
              role: "assistant",
              toolCalls: [
                {
                  arguments: { content: "draft", path: "artifacts/draft.md" },
                  id: "tool_1",
                  name: "write_file",
                },
              ],
            },
            {
              content: JSON.stringify({
                bytesWritten: 5,
                path: "/home/.nakama/orgs/org/profiles/default/artifacts/draft.md",
              }),
              name: "write_file",
              role: "tool",
              toolCallId: "tool_1",
            },
          ],
        }
      );
      sessionStore.set("dm_channel_1", {
        profileId: "default",
        sessionId: "session_test",
        updatedAt: new Date().toISOString(),
      });
      await sessionStore.save();

      const { message, sentMessages } = createDmMessage({
        content: "thanks",
        userId: "424242424242424242",
      });
      await handleMessage(message);

      expect(calls.publishProfileArtifactShare).toBe(0);
      expect(sentMessages.some((reply) => reply.includes("/s/"))).toBe(false);
    });
  });

  test("uploads when the agent calls send_discord_artifact", async () => {
    await withTempHome(async (homeDir) => {
      const { calls, handleMessage, sessionStore } = await createPairedHandler(
        homeDir,
        {
          artifactContentBytes: new TextEncoder().encode("%PDF-1.4"),
          onSendStream: async (_input, handlers) => {
            handlers?.onToolStart?.({
              input: { path: "nakama-pitch-deck.pdf" },
              tool: "send_discord_artifact",
              toolCallId: "tool_1",
            });
            handlers?.onToolEnd?.({
              result: {
                filename: "nakama-pitch-deck.pdf",
                mimeType: "application/pdf",
                ok: true,
                path: "nakama-pitch-deck.pdf",
                sizeBytes: 8,
              },
              tool: "send_discord_artifact",
              toolCallId: "tool_1",
            });
            handlers?.onChunk?.("Here's the pitch deck.");
            return "Here's the pitch deck.";
          },
        }
      );
      sessionStore.set("dm_channel_1", {
        profileId: "default",
        sessionId: "session_test",
        updatedAt: new Date().toISOString(),
      });
      await sessionStore.save();

      const dm = createDmMessage({
        content: "can you send the pitch deck pdf file to me",
        userId: "424242424242424242",
      });
      await handleMessage(dm.message);

      expect(calls.sendStream).toBe(1);
      expect(calls.readProfileArtifactContent).toBe(1);
      expect(dm.fileSendCalls).toBe(1);
      expect(dm.sentMessages.at(-1)).toBe("Here's the pitch deck.");
    });
  });

  test("typed /attach still sends without an agent turn", async () => {
    await withTempHome(async (homeDir) => {
      const { calls, handleMessage, sessionStore } = await createPairedHandler(
        homeDir,
        {
          artifactContentBytes: new TextEncoder().encode("%PDF-1.4"),
          listedArtifacts: [
            {
              filename: "nakama-pitch-deck.pdf",
              mimeType: "application/pdf",
              path: "/tmp/artifacts/nakama-pitch-deck.pdf",
              sizeBytes: 8,
              updatedAt: "2026-08-08T12:51:00.000Z",
            },
          ],
        }
      );
      sessionStore.set("dm_channel_1", {
        profileId: "default",
        sessionId: "session_test",
        updatedAt: new Date().toISOString(),
      });
      await sessionStore.save();

      const dm = createDmMessage({
        content: "/attach",
        userId: "424242424242424242",
      });
      await handleMessage(dm.message);

      expect(dm.fileSendCalls).toBe(1);
      expect(calls.sendStream).toBe(0);
      expect(calls.listProfileArtifacts).toBe(1);
      expect(
        dm.sentMessages.some((reply) =>
          /Use slash commands from Discord/i.test(reply)
        )
      ).toBe(false);
    });
  });

  test("typed /attach reports when no artifact is available", async () => {
    await withTempHome(async (homeDir) => {
      const { handleMessage, sessionStore } =
        await createPairedHandler(homeDir);
      sessionStore.set("dm_channel_1", {
        profileId: "default",
        sessionId: "session_test",
        updatedAt: new Date().toISOString(),
      });
      await sessionStore.save();

      const dm = createDmMessage({
        content: "/attach",
        userId: "424242424242424242",
      });
      await handleMessage(dm.message);

      expect(dm.fileSendCalls).toBe(0);
      expect(
        dm.sentMessages.some((reply) =>
          /No saved artifact to attach/i.test(reply)
        )
      ).toBe(true);
    });
  });

  test("returns a clear error when /attach targets an unsupported type", async () => {
    await withTempHome(async (homeDir) => {
      const { handleMessage, sessionStore } = await createPairedHandler(
        homeDir,
        {
          artifactContentBytes: new Uint8Array([0x4d, 0x5a]),
        }
      );
      sessionStore.set("dm_channel_1", {
        deliverableArtifacts: [
          {
            filename: "payload.exe",
            mimeType: "application/octet-stream",
            path: "payload.exe",
            savedAt: "2026-07-13T10:00:00.000Z",
            sharePath: "/s/tok_exe",
            shareUrl: "https://app.example/s/tok_exe",
            sizeBytes: 2,
          },
        ],
        profileId: "default",
        sessionId: "session_test",
        updatedAt: new Date().toISOString(),
      });
      await sessionStore.save();

      const dm = createDmMessage({
        content: "/attach",
        userId: "424242424242424242",
      });
      await handleMessage(dm.message);

      expect(dm.fileSendCalls).toBe(0);
      expect(
        dm.sentMessages.some((reply) => /unsupported file type/i.test(reply))
      ).toBe(true);
    });
  });
});
describe("createChatHandler early ack", () => {
  async function setupAckHandler(
    homeDir: string,
    onSendStream: NonNullable<
      Parameters<typeof createMockClient>[0]
    >["onSendStream"]
  ) {
    await writeDiscordConfigIni(homeDir, {
      botToken: "discord-bot-token",
      pairedUserIds: ["424242424242424242"],
    });

    const authStore = new DiscordAuthStore();
    await authStore.reload();
    const { client } = createMockClient({ onSendStream });
    const sessionStore = new ChannelSessionStore(
      path.join(homeDir, ".nakama", "discord", "chat-sessions.json")
    );
    await sessionStore.load();
    sessionStore.set("dm_channel_1", {
      profileId: "default",
      sessionId: "session_test",
      updatedAt: new Date().toISOString(),
    });
    await sessionStore.save();
    const orgStore = createTestOrgStore(homeDir);
    await orgStore.load();
    return createChatHandler({
      authStore,
      client,
      config: { botToken: "discord-bot-token", profileId: "default" },
      orgStore,
      sessionStore,
    });
  }

  test("posts the streamed status before tools, then the final outcome", async () => {
    await withTempHome(async (homeDir) => {
      const { handleMessage } = await setupAckHandler(
        homeDir,
        async (_input, handlers) => {
          handlers?.onChunk("Checking the repo first.");
          handlers?.onToolStart?.({
            input: { command: "ls" },
            tool: "bash",
            toolCallId: "tool_1",
          });
          handlers?.onToolEnd?.({
            result: { exitCode: 0 },
            tool: "bash",
            toolCallId: "tool_1",
          });
          handlers?.onChunk("Done — branch is clean.");
          return "Done — branch is clean.";
        }
      );

      const dm = createDmMessage({
        content: "check the repo",
        userId: "424242424242424242",
      });
      await handleMessage(dm.message);

      expect(dm.sentMessages[0]).toBe("Checking the repo first.");
      expect(dm.sentMessages.at(-1)).toBe("Done — branch is clean.");
      expect(dm.sentMessages).toHaveLength(2);
    });
  });

  test("posts a fallback ack when tools start with no streamed text", async () => {
    await withTempHome(async (homeDir) => {
      const { handleMessage } = await setupAckHandler(
        homeDir,
        async (_input, handlers) => {
          handlers?.onToolStart?.({
            input: { command: "ls" },
            tool: "bash",
            toolCallId: "tool_1",
          });
          handlers?.onToolEnd?.({
            result: { exitCode: 0 },
            tool: "bash",
            toolCallId: "tool_1",
          });
          return "All set.";
        }
      );

      const dm = createDmMessage({
        content: "do the thing",
        userId: "424242424242424242",
      });
      await handleMessage(dm.message);

      expect(dm.sentMessages[0]).toBe("On it.");
      expect(dm.sentMessages.at(-1)).toBe("All set.");
    });
  });

  test("does not post an early ack when the turn uses no tools", async () => {
    await withTempHome(async (homeDir) => {
      const { handleMessage } = await setupAckHandler(
        homeDir,
        async (_input, handlers) => {
          handlers?.onChunk("Hello.");
          return "Hello.";
        }
      );

      const dm = createDmMessage({
        content: "hi",
        userId: "424242424242424242",
      });
      await handleMessage(dm.message);

      expect(dm.sentMessages).toEqual(["Hello."]);
    });
  });
});

describe("createChatHandler questionnaire delivery", () => {
  const questionnaire = {
    id: "qset_1",
    questions: [
      {
        allowCustomAnswer: true,
        choices: [
          { id: "playwright", label: "Build Playwright e2e" },
          { id: "manual", label: "Manual steps only" },
        ],
        id: "how-to-run",
        prompt: "How should I run this?",
      },
    ],
    title: "Need input",
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
        content: "help me ship this",
        userId: "424242424242424242",
      });
      await handleMessage(message);

      expect(sentMessages.some((reply) => reply.includes("Need input"))).toBe(
        true
      );
      expect(
        sentMessages.some((reply) => reply.includes("a) Build Playwright e2e"))
      ).toBe(true);
      expect(
        sentMessages.some((reply) => reply.includes("(empty reply)"))
      ).toBe(false);
    });
  });

  test("forwards the next Discord reply to the agent without parsing questionnaire answers", async () => {
    await withTempHome(async (homeDir) => {
      const streamedInputs: unknown[] = [];
      const { handleMessage, sessionStore } = await createPairedHandler(
        homeDir,
        {
          onSendStream: async (input) => {
            streamedInputs.push(input);
            return "Got it.";
          },
          questionnaire,
        }
      );
      sessionStore.set("dm_channel_1", {
        profileId: "default",
        sessionId: "session_test",
        updatedAt: new Date().toISOString(),
      });
      await sessionStore.save();

      const { message, sentMessages } = createDmMessage({
        content: "a",
        userId: "424242424242424242",
      });
      await handleMessage(message);

      expect(streamedInputs[0]).toEqual({ message: "a" });
      expect(sentMessages).toContain("Got it.");
      expect(
        sentMessages.some((reply) => reply.includes("Couldn't parse that"))
      ).toBe(false);
    });
  });
});

describe("createChatHandler guild auth silence", () => {
  test("unlinked guild mentions stay quiet", async () => {
    await withTempHome(async (homeDir) => {
      const { handleMessage, calls } = await createPairedHandler(homeDir, {
        pairedUserIds: [],
      });
      const mention = createGuildChatMessage({
        content: "<@bot_id> hello",
        mentionsBot: true,
        userId: "555555555555555555",
      });

      await handleMessage(mention.message);

      expect(mention.channelSentMessages).toEqual([]);
      expect(calls.sendStream).toBe(0);
    });
  });

  test("unlinked guild slash deletes the deferred reply", async () => {
    await withTempHome(async (homeDir) => {
      const { handleSlashCommand } = await createPairedHandler(homeDir, {
        pairedUserIds: [],
      });
      const statusCmd = createSlashInteraction({
        commandName: "status",
        userId: "555555555555555555",
      });

      await handleSlashCommand(statusCmd.interaction);

      expect(statusCmd.replies).toEqual(["__deleted__"]);
    });
  });
});

describe("createChatHandler guild thread routing", () => {
  test("mention in a guild channel creates a thread and replies inside it", async () => {
    await withTempHome(async (homeDir) => {
      const streamedInputs: unknown[] = [];
      const { handleMessage, threadStore } = await createPairedHandler(
        homeDir,
        {
          onSendStream: async (input) => {
            streamedInputs.push(input);
            return "Thread reply";
          },
        }
      );

      const guild = createGuildChatMessage({
        content: "<@bot_id> summarize this",
        mentionsBot: true,
      });
      await handleMessage(guild.message);

      expect(guild.startThreadCalls).toBe(1);
      expect(guild.lastThreadName).toBe("summarize this");
      expect(guild.threadSentMessages).toContain("Thread reply");
      expect(guild.channelSentMessages).not.toContain("Thread reply");
      expect(threadStore.hasThreadId(guild.createdThreadId!)).toBe(true);
      expect(streamedInputs[0]).toEqual({ message: "summarize this" });
    });
  });

  test("role mention of a role the bot holds creates a thread", async () => {
    await withTempHome(async (homeDir) => {
      const streamedInputs: unknown[] = [];
      const { handleMessage, threadStore } = await createPairedHandler(
        homeDir,
        {
          onSendStream: async (input) => {
            streamedInputs.push(input);
            return "Role mention reply";
          },
        }
      );

      const roleId = "1525964112708894884";
      const guild = createGuildChatMessage({
        botHeldRoleIds: [roleId],
        content: `<@&${roleId}> pull the latest main branch`,
        mentionedRoleIds: [roleId],
      });
      await handleMessage(guild.message);

      expect(guild.startThreadCalls).toBe(1);
      expect(guild.lastThreadName).toBe("pull the latest main branch");
      expect(guild.threadSentMessages).toContain("Role mention reply");
      expect(threadStore.hasThreadId(guild.createdThreadId!)).toBe(true);
      expect(streamedInputs[0]).toEqual({
        message: "pull the latest main branch",
      });
    });
  });

  test("second mention in the same channel creates a new thread", async () => {
    await withTempHome(async (homeDir) => {
      const { handleMessage, threadStore } = await createPairedHandler(
        homeDir,
        {
          onSendStream: async () => "Again",
        }
      );

      const first = createGuildChatMessage({
        content: "<@bot_id> first question",
        mentionsBot: true,
      });
      await handleMessage(first.message);
      const firstThreadId = first.createdThreadId;
      expect(firstThreadId).toBeTruthy();
      expect(first.startThreadCalls).toBe(1);
      expect(threadStore.hasThreadId(firstThreadId!)).toBe(true);

      const second = createGuildChatMessage({
        content: "<@bot_id> follow up topic",
        mentionsBot: true,
      });
      await handleMessage(second.message);

      expect(second.startThreadCalls).toBe(1);
      const secondThreadId = second.createdThreadId;
      expect(secondThreadId).toBeTruthy();
      expect(secondThreadId).not.toBe(firstThreadId);
      expect(threadStore.hasThreadId(firstThreadId!)).toBe(true);
      expect(threadStore.hasThreadId(secondThreadId!)).toBe(true);
      expect(second.threadSentMessages).toContain("Again");
      expect(second.channelSentMessages).not.toContain("Again");
    });
  });

  test("first thread stays independent after a second mention creates another thread", async () => {
    await withTempHome(async (homeDir) => {
      const streamedByThread: string[] = [];
      const { handleMessage, threadStore, sessionStore } =
        await createPairedHandler(homeDir, {
          onSendStream: async (input) => {
            streamedByThread.push(
              String((input as { message?: string }).message ?? "")
            );
            return "ok";
          },
        });

      const first = createGuildChatMessage({
        content: "<@bot_id> topic one",
        mentionsBot: true,
      });
      await handleMessage(first.message);
      const firstThreadId = first.createdThreadId!;

      const second = createGuildChatMessage({
        content: "<@bot_id> topic two",
        mentionsBot: true,
      });
      await handleMessage(second.message);

      const followUp = createGuildChatMessage({
        content: "continue topic one",
        inThread: true,
        parentId: "guild_channel_1",
        threadId: firstThreadId,
      });
      await handleMessage(followUp.message);

      expect(followUp.startThreadCalls).toBe(0);
      expect(followUp.threadSentMessages).toContain("ok");
      expect(threadStore.hasThreadId(firstThreadId)).toBe(true);
      expect(
        sessionStore.get(`g:guild_channel_1:t:${firstThreadId}`)
      ).toBeTruthy();
      expect(streamedByThread).toContain("continue topic one");
    });
  });

  test("overlapping parent mentions run agent turns concurrently", async () => {
    await withTempHome(async (homeDir) => {
      let releaseFirst!: () => void;
      const firstGate = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      let entered = 0;
      let maxInFlight = 0;
      let inFlight = 0;

      const { handleMessage } = await createPairedHandler(homeDir, {
        onSendStream: async () => {
          entered += 1;
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          if (entered === 1) {
            await firstGate;
          }
          inFlight -= 1;
          return "done";
        },
      });

      const first = createGuildChatMessage({
        content: "<@bot_id> slow",
        mentionsBot: true,
      });
      const second = createGuildChatMessage({
        content: "<@bot_id> fast",
        mentionsBot: true,
      });

      const firstTurn = handleMessage(first.message);
      await waitForCondition(
        () => entered >= 1,
        "first turn never reached onSendStream"
      );
      const secondTurn = handleMessage(second.message);
      await waitForCondition(
        () => entered >= 2,
        "second turn never reached onSendStream; turns are not concurrent"
      );

      expect(entered).toBe(2);
      expect(maxInFlight).toBeGreaterThanOrEqual(2);

      releaseFirst();
      await Promise.all([firstTurn, secondTurn]);
    });
  });

  test("thread message without mention is answered in a bot-owned thread", async () => {
    await withTempHome(async (homeDir) => {
      const streamedInputs: unknown[] = [];
      const { handleMessage, threadStore } = await createPairedHandler(
        homeDir,
        {
          onSendStream: async (input) => {
            streamedInputs.push(input);
            return "In-thread answer";
          },
        }
      );

      threadStore.add("thread_42");
      await threadStore.save();

      const guild = createGuildChatMessage({
        content: "keep going",
        inThread: true,
        parentId: "guild_channel_1",
        threadId: "thread_42",
      });
      await handleMessage(guild.message);

      expect(guild.startThreadCalls).toBe(0);
      expect(guild.threadSentMessages).toContain("In-thread answer");
      expect(streamedInputs[0]).toEqual({ message: "keep going" });
    });
  });

  test("ignores unmentioned messages in threads the agent did not start", async () => {
    await withTempHome(async (homeDir) => {
      const streamedInputs: unknown[] = [];
      const { handleMessage } = await createPairedHandler(homeDir, {
        onSendStream: async (input) => {
          streamedInputs.push(input);
          return "Should not reply";
        },
      });

      const guild = createGuildChatMessage({
        content: "please join this thread",
        inThread: true,
        parentId: "guild_channel_1",
        threadId: "user_thread_9",
      });
      await handleMessage(guild.message);

      expect(guild.startThreadCalls).toBe(0);
      expect(guild.threadSentMessages).toHaveLength(0);
      expect(guild.channelSentMessages).toHaveLength(0);
      expect(streamedInputs).toHaveLength(0);
    });
  });

  test("claims a foreign thread on @mention and replies inside it", async () => {
    await withTempHome(async (homeDir) => {
      const { handleMessage, threadStore } = await createPairedHandler(
        homeDir,
        {
          onSendStream: async () => "Joined the thread",
        }
      );

      expect(threadStore.hasThreadId("user_thread_9")).toBe(false);

      const guild = createGuildChatMessage({
        content: "<@bot_id> please join this thread",
        inThread: true,
        mentionsBot: true,
        parentId: "guild_channel_1",
        threadId: "user_thread_9",
      });
      await handleMessage(guild.message);

      expect(guild.startThreadCalls).toBe(0);
      expect(threadStore.hasThreadId("user_thread_9")).toBe(true);
      expect(guild.threadSentMessages).toContain("Joined the thread");
      expect(guild.channelSentMessages).toHaveLength(0);

      const followUp = createGuildChatMessage({
        content: "keep going",
        inThread: true,
        parentId: "guild_channel_1",
        threadId: "user_thread_9",
      });
      await handleMessage(followUp.message);

      expect(followUp.threadSentMessages.length).toBeGreaterThan(0);
    });
  });

  test("thread messages reuse the parent channel org selection", async () => {
    await withTempHome(async (homeDir) => {
      const streamedInputs: unknown[] = [];
      const { handleMessage, orgStore, threadStore } =
        await createPairedHandler(homeDir, {
          onSendStream: async (input) => {
            streamedInputs.push(input);
            return "In-thread answer";
          },
          orgs: createMultiTestOrgs(),
        });

      orgStore.set("g:guild_channel_1", "org_a");
      await orgStore.save();
      threadStore.add("thread_42");
      await threadStore.save();

      const guild = createGuildChatMessage({
        content: "keep going",
        inThread: true,
        parentId: "guild_channel_1",
        threadId: "thread_42",
      });
      await handleMessage(guild.message);

      expect(
        guild.threadSentMessages.some((text) =>
          text.includes("Choose an organization")
        )
      ).toBe(false);
      expect(guild.threadSentMessages).toContain("In-thread answer");
      expect(streamedInputs).toHaveLength(1);
      expect(orgStore.get("g:thread_42")).toBeUndefined();
      expect(orgStore.get("g:guild_channel_1")?.orgId).toBe("org_a");
    });
  });

  test("new threads inherit the parent channel profile", async () => {
    await withTempHome(async (homeDir) => {
      const { handleMessage, sessionStore, createdSessionProfileIds } =
        await createPairedHandler(homeDir, {
          configProfileId: "default",
          onSendStream: async () => "Thread reply",
          profiles: [
            { id: "default", name: "Default" },
            { id: "support", name: "Support" },
          ],
        });

      sessionStore.set("guild_channel_1", {
        profileId: "support",
        sessionId: "channel_session",
        updatedAt: new Date().toISOString(),
      });
      await sessionStore.save();

      const guild = createGuildChatMessage({
        content: "<@bot_id> help a customer",
        mentionsBot: true,
      });
      await handleMessage(guild.message);

      const threadId = guild.createdThreadId;
      expect(threadId).toBeTruthy();
      expect(createdSessionProfileIds).toContain("support");
      expect(
        sessionStore.get(`g:guild_channel_1:t:${threadId}`)?.profileId
      ).toBe("support");
      expect(sessionStore.get("guild_channel_1")?.profileId).toBe("support");
    });
  });

  test("thread-specific profile override is kept for that thread only", async () => {
    await withTempHome(async (homeDir) => {
      const {
        handleMessage,
        sessionStore,
        threadStore,
        createdSessionProfileIds,
      } = await createPairedHandler(homeDir, {
        configProfileId: "default",
        onSendStream: async () => "ok",
        profiles: [
          { id: "default", name: "Default" },
          { id: "support", name: "Support" },
          { id: "sales", name: "Sales" },
        ],
      });

      sessionStore.set("guild_channel_1", {
        profileId: "support",
        sessionId: "channel_session",
        updatedAt: new Date().toISOString(),
      });
      await sessionStore.save();
      threadStore.add("thread_42");
      await threadStore.save();

      const switchProfile = createGuildChatMessage({
        content: "/profile sales",
        inThread: true,
        parentId: "guild_channel_1",
        threadId: "thread_42",
      });
      await handleMessage(switchProfile.message);

      expect(sessionStore.get("g:guild_channel_1:t:thread_42")?.profileId).toBe(
        "sales"
      );
      expect(sessionStore.get("guild_channel_1")?.profileId).toBe("support");
      expect(createdSessionProfileIds.at(-1)).toBe("sales");
    });
  });

  test("slash commands in threads reuse the parent channel org selection", async () => {
    await withTempHome(async (homeDir) => {
      const { handleSlashCommand, orgStore } = await createPairedHandler(
        homeDir,
        {
          orgs: createMultiTestOrgs(),
        }
      );

      orgStore.set("g:guild_channel_1", "org_b");
      await orgStore.save();

      const clearCmd = createSlashInteraction({
        commandName: "clear",
        inThread: true,
        parentId: "guild_channel_1",
        threadId: "thread_1",
      });
      await handleSlashCommand(clearCmd.interaction);

      expect(
        clearCmd.replies.some((text) => text.includes("Choose an organization"))
      ).toBe(false);
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
      const { handleSlashCommand, sessionStore } =
        await createPairedHandler(homeDir);
      const conversationKey = "g:guild_channel_1:t:thread_1";
      sessionStore.set(conversationKey, {
        profileId: "default",
        sessionId: "session_test",
        updatedAt: new Date().toISOString(),
      });
      await sessionStore.save();

      const clearCmd = createSlashInteraction({
        commandName: "clear",
        inThread: true,
        parentId: "guild_channel_1",
        threadId: "thread_1",
      });
      await handleSlashCommand(clearCmd.interaction);
      expect(clearCmd.replies).toContain("History cleared.");

      const newCmd = createSlashInteraction({
        commandName: "new",
        inThread: true,
        parentId: "guild_channel_1",
        threadId: "thread_1",
      });
      await handleSlashCommand(newCmd.interaction);
      expect(newCmd.replies).toContain("Started a new conversation.");

      const stopCmd = createSlashInteraction({
        commandName: "stop",
        inThread: true,
        parentId: "guild_channel_1",
        threadId: "thread_1",
      });
      await handleSlashCommand(stopCmd.interaction);
      expect(stopCmd.replies).toContain("Nothing to stop.");
    });
  });

  test("close archives a bot-owned thread and clears ownership for that thread only", async () => {
    await withTempHome(async (homeDir) => {
      const { handleSlashCommand, threadStore, handleMessage } =
        await createPairedHandler(homeDir);
      threadStore.add("thread_1");
      threadStore.add("thread_sibling");
      await threadStore.save();

      const closeCmd = createSlashInteraction({
        commandName: "close",
        inThread: true,
        parentId: "guild_channel_1",
        threadId: "thread_1",
      });
      await handleSlashCommand(closeCmd.interaction);

      expect(closeCmd.replies).toContain("Thread closed.");
      expect(
        (closeCmd.interaction.channel as { archived?: boolean }).archived
      ).toBe(true);
      expect(threadStore.hasThreadId("thread_1")).toBe(false);
      expect(threadStore.hasThreadId("thread_sibling")).toBe(true);

      const sibling = createGuildChatMessage({
        content: "still here",
        inThread: true,
        parentId: "guild_channel_1",
        threadId: "thread_sibling",
      });
      await handleMessage(sibling.message);
      expect(sibling.threadSentMessages.length).toBeGreaterThan(0);
    });
  });

  test("close rejects non-thread channels and foreign threads", async () => {
    await withTempHome(async (homeDir) => {
      const { handleSlashCommand, threadStore } =
        await createPairedHandler(homeDir);
      threadStore.add("thread_owned");
      await threadStore.save();

      const channelClose = createSlashInteraction({
        channelId: "guild_channel_1",
        commandName: "close",
      });
      await handleSlashCommand(channelClose.interaction);
      expect(channelClose.replies).toContain(
        "Use /close inside a bot conversation thread."
      );

      const foreignClose = createSlashInteraction({
        commandName: "close",
        inThread: true,
        parentId: "guild_channel_1",
        threadId: "user_thread_9",
      });
      await handleSlashCommand(foreignClose.interaction);
      expect(foreignClose.replies).toContain(
        "I can only close threads I started."
      );
      expect(threadStore.hasThreadId("thread_owned")).toBe(true);
    });
  });

  test("denies non-paired users", async () => {
    await withTempHome(async (homeDir) => {
      const { handleSlashCommand } = await createPairedHandler(homeDir, {
        pairedUserIds: [],
      });
      const allowCmd = createSlashInteraction({
        commandName: "allow",
        userId: "555555555555555555",
        userOption: { id: "999999999999999999" },
      });
      await handleSlashCommand(allowCmd.interaction);

      expect(
        allowCmd.replies.some((reply) => /not authorized/i.test(reply))
      ).toBe(true);
      expect((await loadDiscordConfigFile())?.allowedUserIds ?? []).toEqual([]);
    });
  });

  test("adds a mentioned user", async () => {
    await withTempHome(async (homeDir) => {
      const { handleSlashCommand } = await createPairedHandler(homeDir);
      const targetUserId = "777777777777777777";
      const allowCmd = createSlashInteraction({
        commandName: "allow",
        userOption: { id: targetUserId, username: "alice" },
      });
      await handleSlashCommand(allowCmd.interaction);

      expect(
        allowCmd.replies.some((reply) => reply.includes(`<@${targetUserId}>`))
      ).toBe(true);
      expect((await loadDiscordConfigFile())?.allowedUserIds).toContain(
        targetUserId
      );
    });
  });

  test("reports already-allowed users", async () => {
    await withTempHome(async (homeDir) => {
      const targetUserId = "888888888888888888";
      const { handleSlashCommand } = await createPairedHandler(homeDir, {
        allowedUserIds: [targetUserId],
      });
      const allowCmd = createSlashInteraction({
        commandName: "allow",
        userOption: { id: targetUserId },
      });
      await handleSlashCommand(allowCmd.interaction);

      expect(allowCmd.replies.some((reply) => /already/i.test(reply))).toBe(
        true
      );
    });
  });

  test("threadStore save failure still tracks the created Discord thread", async () => {
    await withTempHome(async (homeDir) => {
      const streamedInputs: unknown[] = [];
      const { handleMessage, threadStore } = await createPairedHandler(
        homeDir,
        {
          onSendStream: async (input) => {
            streamedInputs.push(input);
            return "Tracked despite save failure";
          },
        }
      );

      const originalSave = threadStore.save.bind(threadStore);
      let saveCalls = 0;
      threadStore.save = async () => {
        saveCalls += 1;
        throw new Error("ENOSPC");
      };

      const mention = createGuildChatMessage({
        content: "<@bot_id> start me",
        mentionsBot: true,
      });
      await handleMessage(mention.message);

      const threadId = mention.createdThreadId;
      expect(threadId).toBeTruthy();
      expect(saveCalls).toBeGreaterThan(0);
      expect(threadStore.hasThreadId(threadId!)).toBe(true);
      expect(mention.threadSentMessages).toContain(
        "Tracked despite save failure"
      );
      expect(mention.channelSentMessages).not.toContain(
        "Tracked despite save failure"
      );

      threadStore.save = originalSave;

      const followUp = createGuildChatMessage({
        content: "still here",
        inThread: true,
        parentId: "guild_channel_1",
        threadId: threadId!,
      });
      await handleMessage(followUp.message);

      expect(followUp.threadSentMessages).toContain(
        "Tracked despite save failure"
      );
      expect(streamedInputs).toHaveLength(2);
    });
  });

  test("claim-thread save failure still tracks ownership for follow-ups", async () => {
    await withTempHome(async (homeDir) => {
      const { handleMessage, threadStore } = await createPairedHandler(
        homeDir,
        {
          onSendStream: async () => "Claimed despite save failure",
        }
      );

      threadStore.save = async () => {
        throw new Error("EACCES");
      };

      const claim = createGuildChatMessage({
        content: "<@bot_id> join please",
        inThread: true,
        mentionsBot: true,
        parentId: "guild_channel_1",
        threadId: "user_thread_claim",
      });
      await handleMessage(claim.message);

      expect(threadStore.hasThreadId("user_thread_claim")).toBe(true);
      expect(claim.threadSentMessages).toContain(
        "Claimed despite save failure"
      );

      const followUp = createGuildChatMessage({
        content: "keep going",
        inThread: true,
        parentId: "guild_channel_1",
        threadId: "user_thread_claim",
      });
      await handleMessage(followUp.message);

      expect(followUp.threadSentMessages.length).toBeGreaterThan(0);
    });
  });

  test("partial thread hydrates parentId via channel.fetch so org keys stay correct", async () => {
    await withTempHome(async (homeDir) => {
      const streamedByKey: string[] = [];
      const { handleMessage, threadStore, orgStore, sessionStore } =
        await createPairedHandler(homeDir, {
          onSendStream: async (input) => {
            streamedByKey.push(
              String((input as { message?: string }).message ?? "")
            );
            return "Partial ok";
          },
          orgs: createMultiTestOrgs(),
        });

      orgStore.set("g:guild_channel_1", "org_a");
      await orgStore.save();
      threadStore.add("thread_partial");
      await threadStore.save();

      const followUp = createGuildChatMessage({
        content: "hello from partial",
        fetchParentId: "guild_channel_1",
        inThread: true,
        parentId: null,
        threadId: "thread_partial",
      });
      await handleMessage(followUp.message);

      expect(followUp.threadSentMessages).toContain("Partial ok");
      expect(streamedByKey).toEqual(["hello from partial"]);
      expect(orgStore.get("g:thread_partial")).toBeUndefined();
      expect(
        sessionStore.get("g:guild_channel_1:t:thread_partial")
      ).toBeTruthy();
      expect(
        sessionStore.get("g:thread_partial:t:thread_partial")
      ).toBeUndefined();
    });
  });

  test("slash commands in partial threads hydrate parentId via channel.fetch", async () => {
    await withTempHome(async (homeDir) => {
      const { handleSlashCommand, orgStore, sessionStore } =
        await createPairedHandler(homeDir, {
          orgs: createMultiTestOrgs(),
        });

      orgStore.set("g:guild_channel_1", "org_b");
      await orgStore.save();
      sessionStore.set("g:guild_channel_1:t:thread_partial_slash", {
        profileId: "default",
        sessionId: "session_test",
        updatedAt: new Date().toISOString(),
      });
      await sessionStore.save();

      const clearCmd = createSlashInteraction({
        commandName: "clear",
        fetchParentId: "guild_channel_1",
        inThread: true,
        parentId: null,
        threadId: "thread_partial_slash",
      });
      await handleSlashCommand(clearCmd.interaction);

      expect(
        clearCmd.replies.some((text) => text.includes("Choose an organization"))
      ).toBe(false);
      expect(clearCmd.replies).toContain("History cleared.");
      expect(orgStore.get("g:thread_partial_slash")).toBeUndefined();
    });
  });

  test("wedged chat lock recovers so follow-ups are not silenced forever", async () => {
    chatLockOptions.waitMs = 40;

    let releaseHang!: () => void;
    const hang = new Promise<void>((resolve) => {
      releaseHang = resolve;
    });

    const order: string[] = [];
    const first = withChatLock("g:channel:t:thread_wedge", async () => {
      order.push("first-start");
      await hang;
      order.push("first-end");
    });

    await Bun.sleep(5);
    const secondStarted = Date.now();
    const second = withChatLock("g:channel:t:thread_wedge", async () => {
      order.push("second");
    });

    await second;
    const waitedMs = Date.now() - secondStarted;
    expect(waitedMs).toBeGreaterThanOrEqual(35);
    expect(order).toEqual(["first-start", "second"]);

    releaseHang();
    await first;
    expect(order).toEqual(["first-start", "second", "first-end"]);
  });

  test("withChatLock removes map entries after the critical section", async () => {
    expect(getChatLockCountForTests()).toBe(0);

    let releaseHold!: () => void;
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });

    const first = withChatLock("dm:lock-leak", async () => {
      expect(getChatLockCountForTests()).toBe(1);
      await hold;
    });

    await Bun.sleep(5);
    expect(getChatLockCountForTests()).toBe(1);

    releaseHold();
    await first;
    expect(getChatLockCountForTests()).toBe(0);
  });

  test("withChatLock continues after a rejected predecessor and clears the map", async () => {
    const stale = Promise.reject(new Error("stale predecessor"));
    // Prevent the seed itself from firing unhandledRejection before adopt.
    stale.catch(() => undefined);
    seedChatLockForTests("dm:reject-pred", stale);
    chatLockOptions.waitMs = 0;

    let ran = false;
    await withChatLock("dm:reject-pred", async () => {
      ran = true;
    });

    expect(ran).toBe(true);
    expect(getChatLockCountForTests()).toBe(0);
  });

  test("message handler reloads auth only after the conversation lock is free", async () => {
    await withTempHome(async (homeDir) => {
      await writeDiscordConfigIni(homeDir, {
        botToken: "discord-bot-token",
        handshakeCode: "ABCD1234",
        pairedUserIds: [],
      });

      const authStore = new DiscordAuthStore();
      await authStore.reload();
      const { client } = createMockClient();
      const sessionStore = new ChannelSessionStore(
        path.join(homeDir, ".nakama", "discord", "chat-sessions.json")
      );
      await sessionStore.load();
      const threadStore = new ThreadStore(
        path.join(homeDir, ".nakama", "discord", "chat-threads.json")
      );
      await threadStore.load();
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const { handleMessage } = createChatHandler({
        authStore,
        client,
        config: { botToken: "discord-bot-token", profileId: "default" },
        orgStore,
        sessionStore,
        threadStore,
      });

      const dm = createDmMessage({
        channelId: "dm_auth_lock",
        content: "ABCD1234",
        userId: "999999999999999999",
      });
      const conversationKey = dm.message.channel.id;

      let releaseHold!: () => void;
      const hold = new Promise<void>((resolve) => {
        releaseHold = resolve;
      });
      const held = withChatLock(conversationKey, async () => {
        await hold;
      });

      const reloadCalls: number[] = [];
      const originalReload = authStore.reload.bind(authStore);
      authStore.reload = async () => {
        reloadCalls.push(Date.now());
        return originalReload();
      };

      const pending = handleMessage(dm.message);
      await Bun.sleep(30);
      expect(reloadCalls).toEqual([]);

      releaseHold();
      await held;
      await pending;
      expect(reloadCalls.length).toBeGreaterThanOrEqual(1);
    });
  });
});

describe("createChatHandler inbound images", () => {
  test("image-only DM reaches the agent with images populated", async () => {
    await withTempHome(async (homeDir) => {
      const pngBytes = new Uint8Array([137, 80, 78, 71]);
      const streamedInputs: unknown[] = [];
      const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(pngBytes, { status: 200 })
      );

      try {
        const { handleMessage } = await createPairedHandler(homeDir, {
          onSendStream: async (input) => {
            streamedInputs.push(input);
            return "Looks like a PNG.";
          },
        });

        const dm = createDmMessage({
          attachments: [
            {
              contentType: "image/png",
              size: pngBytes.byteLength,
              url: "https://cdn.example/shot.png",
            },
          ],
          content: "",
          userId: "424242424242424242",
        });
        await handleMessage(dm.message);

        expect(streamedInputs).toEqual([
          {
            images: [
              {
                data: Buffer.from(pngBytes).toString("base64"),
                mediaType: "image/png",
              },
            ],
            message: "",
          },
        ]);
        expect(dm.sentMessages).toContain("Looks like a PNG.");
        expect(
          dm.sentMessages.some((reply) => /text messages only/i.test(reply))
        ).toBe(false);
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });

  test("empty non-image DM still gets Text messages only.", async () => {
    await withTempHome(async (homeDir) => {
      const { handleMessage, calls } = await createPairedHandler(homeDir);
      const dm = createDmMessage({
        content: "",
        userId: "424242424242424242",
      });
      await handleMessage(dm.message);

      expect(calls.sendStream).toBe(0);
      expect(dm.sentMessages).toContain("Text messages only.");
    });
  });

  test("pdf-only DM gets unsupported attachment reply", async () => {
    await withTempHome(async (homeDir) => {
      const { handleMessage, calls } = await createPairedHandler(homeDir);
      const dm = createDmMessage({
        attachments: [
          {
            contentType: "application/pdf",
            name: "notes.pdf",
            size: 100,
          },
        ],
        content: "",
        userId: "424242424242424242",
      });
      await handleMessage(dm.message);

      expect(calls.sendStream).toBe(0);
      expect(dm.sentMessages).toContain(UNSUPPORTED_ATTACHMENT_REPLY);
    });
  });

  test("too many images rejects without starting chat", async () => {
    await withTempHome(async (homeDir) => {
      const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(new Uint8Array(8), { status: 200 })
      );

      try {
        const { handleMessage, calls } = await createPairedHandler(homeDir);
        const dm = createDmMessage({
          attachments: Array.from({ length: 6 }, (_, index) => ({
            contentType: "image/png",
            name: `shot-${index}.png`,
            size: 8,
            url: `https://cdn.example/shot-${index}.png`,
          })),
          content: "",
          userId: "424242424242424242",
        });
        await handleMessage(dm.message);

        expect(calls.sendStream).toBe(0);
        expect(dm.sentMessages).toContain(TOO_MANY_IMAGES_REPLY);
        expect(fetchSpy).not.toHaveBeenCalled();
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });

  test("guild mention plus image-only reaches the agent", async () => {
    await withTempHome(async (homeDir) => {
      const pngBytes = new Uint8Array([137, 80, 78, 71]);
      const streamedInputs: unknown[] = [];
      const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(pngBytes, { status: 200 })
      );

      try {
        const { handleMessage } = await createPairedHandler(homeDir, {
          onSendStream: async (input) => {
            streamedInputs.push(input);
            return "Got the screenshot.";
          },
        });

        const guild = createGuildChatMessage({
          attachments: [
            {
              contentType: "image/png",
              name: "shot.png",
              size: pngBytes.byteLength,
            },
          ],
          content: "<@bot_id>",
          mentionsBot: true,
          userId: "424242424242424242",
        });
        await handleMessage(guild.message);

        expect(streamedInputs.length).toBe(1);
        expect(
          (streamedInputs[0] as { images?: unknown[] }).images
        ).toHaveLength(1);
        expect(guild.threadSentMessages).toContain("Got the screenshot.");
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });

  test("guild image without mention does not fetch", async () => {
    await withTempHome(async (homeDir) => {
      const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(new Uint8Array(8), { status: 200 })
      );

      try {
        const { handleMessage, calls } = await createPairedHandler(homeDir);
        const guild = createGuildChatMessage({
          attachments: [
            {
              contentType: "image/png",
              name: "shot.png",
              size: 8,
            },
          ],
          content: "",
          mentionsBot: false,
          userId: "424242424242424242",
        });
        await handleMessage(guild.message);

        expect(calls.sendStream).toBe(0);
        expect(fetchSpy).not.toHaveBeenCalled();
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });
});

describe("createChatHandler session hot cache", () => {
  test("reuses RemoteChatSession across messages without recreate", async () => {
    await withTempHome(async (homeDir) => {
      const { handleMessage, calls, sessionStore } =
        await createPairedHandler(homeDir);
      sessionStore.set("dm_channel_1", {
        profileId: "default",
        sessionId: "session_test",
        updatedAt: new Date().toISOString(),
      });
      await sessionStore.save();

      await handleMessage(createDmMessage({ content: "one" }).message);
      await handleMessage(createDmMessage({ content: "two" }).message);

      expect(calls.createSession).toBe(0);
      expect(calls.createChatSession).toBe(1);
      // 1 resolve validation + 1 artifact read per turn (hot path skips resolve getMessages)
      expect(calls.getMessages).toBe(3);
      expect(calls.sendStream).toBe(2);
    });
  });
});
