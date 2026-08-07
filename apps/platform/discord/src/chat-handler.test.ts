import path from "node:path";
import { describe, expect, test } from "bun:test";
import type { ChatMessage } from "@nakama/core/contract";
import { DiscordAuthStore } from "./auth-store";
import { createChatHandler } from "./chat-handler";
import { SessionStore } from "./session-store";
import {
  createDmMessage,
  createMockClient,
  createTestOrgStore,
  withTempHome,
  writeDiscordConfigIni,
} from "./test-helpers";

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

  test("posts a publish share link after a paired save-artifact turn", async () => {
    await withTempHome(async (homeDir) => {
      await writeDiscordConfigIni(homeDir, {
        botToken: "discord-bot-token",
        pairedUserIds: ["424242424242424242"],
      });

      const authStore = new DiscordAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient({ messages: artifactMessages });
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
      const { handleMessage } = createChatHandler({
        client,
        config: { botToken: "discord-bot-token", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
      });

      const { message, sentMessages } = createDmMessage({
        userId: "424242424242424242",
        content: "thanks",
      });
      await handleMessage(message);

      expect(calls.publishProfileArtifactShare).toBe(1);
      expect(sentMessages.some((reply) => reply.includes("https://app.example/s/tok_test"))).toBe(
        true,
      );
    });
  });

  test("does not publish when the turn has no sidecar pair", async () => {
    await withTempHome(async (homeDir) => {
      await writeDiscordConfigIni(homeDir, {
        botToken: "discord-bot-token",
        pairedUserIds: ["424242424242424242"],
      });

      const authStore = new DiscordAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient({
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
      const { handleMessage } = createChatHandler({
        client,
        config: { botToken: "discord-bot-token", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
      });

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
      await writeDiscordConfigIni(homeDir, {
        botToken: "discord-bot-token",
        pairedUserIds: ["424242424242424242"],
      });

      const authStore = new DiscordAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient();
      const sessionStore = new SessionStore(
        path.join(homeDir, ".nakama", "discord", "chat-sessions.json"),
      );
      await sessionStore.load();
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
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const { handleMessage } = createChatHandler({
        client,
        config: { botToken: "discord-bot-token", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
      });

      const dm = createDmMessage({
        userId: "424242424242424242",
        content: "send me the file",
      });
      await handleMessage(dm.message);

      expect(calls.readProfileArtifactContent).toBe(1);
      expect(dm.fileSendCalls).toBe(1);
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
      await writeDiscordConfigIni(homeDir, {
        botToken: "discord-bot-token",
        pairedUserIds: ["424242424242424242"],
      });

      const authStore = new DiscordAuthStore();
      await authStore.reload();
      const { client } = createMockClient({
        onSendStream: async (_input, handlers) => {
          handlers?.onQuestionnaireUpdated?.(questionnaire);
          return "";
        },
      });
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
      const { handleMessage } = createChatHandler({
        client,
        config: { botToken: "discord-bot-token", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
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

  test("maps the next Discord reply into Answers for the pending questionnaire", async () => {
    await withTempHome(async (homeDir) => {
      await writeDiscordConfigIni(homeDir, {
        botToken: "discord-bot-token",
        pairedUserIds: ["424242424242424242"],
      });

      const authStore = new DiscordAuthStore();
      await authStore.reload();
      const streamedInputs: unknown[] = [];
      const { client } = createMockClient({
        questionnaire,
        onSendStream: async (input) => {
          streamedInputs.push(input);
          return "Got it.";
        },
      });
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
      const { handleMessage } = createChatHandler({
        client,
        config: { botToken: "discord-bot-token", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
      });

      const { message, sentMessages } = createDmMessage({
        userId: "424242424242424242",
        content: "a",
      });
      await handleMessage(message);

      expect(streamedInputs[0]).toEqual({
        message: [
          "Answers",
          "",
          "Q: How should I run this?",
          "A: Build Playwright e2e",
        ].join("\n"),
      });
      expect(sentMessages).toContain("Got it.");
    });
  });
});
