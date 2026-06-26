import path from "node:path";
import { describe, expect, test, spyOn, afterEach } from "bun:test";
import { TelegramAuthStore } from "./auth-store";
import { createChatHandler } from "./chat-handler";
import { UNSUPPORTED_DOCUMENT_TYPES_REPLY, UNSUPPORTED_MEDIA_REPLY } from "./attachments";
import { SessionStore } from "./session-store";
import {
  createMessageContext,
  createMockClient,
  createMultiTestOrgs,
  createTestOrgStore,
  withTempHome,
  writeTelegramConfigIni,
} from "./test-helpers";

describe("createChatHandler security", () => {
  test("ignores non-private chats", async () => {
    await withTempHome(async (homeDir) => {
      await writeTelegramConfigIni(homeDir, {
        botToken: "1234567890:TEST",
        handshakeCode: "ABCD1234",
      });

      const authStore = new TelegramAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient();
      const sessionStore = new SessionStore(
        path.join(homeDir, ".tinyclaw", "telegram", "chat-sessions.json"),
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
      });

      const { ctx, replies } = createMessageContext({
        userId: 42,
        text: "hello",
        chatType: "group",
      });

      await handleMessage(ctx);

      expect(replies).toEqual([]);
      expect(calls.createSession).toBe(0);
      expect(calls.sendStream).toBe(0);
    });
  });

  test("ignores messages without a sender id", async () => {
    await withTempHome(async (homeDir) => {
      await writeTelegramConfigIni(homeDir, {
        botToken: "1234567890:TEST",
        handshakeCode: "ABCD1234",
      });

      const authStore = new TelegramAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient();
      const sessionStore = new SessionStore(
        path.join(homeDir, ".tinyclaw", "telegram", "chat-sessions.json"),
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
      });

      const { ctx, replies } = createMessageContext({ text: "hello" });
      delete (ctx as { from?: unknown }).from;

      await handleMessage(ctx);

      expect(replies).toEqual([]);
      expect(calls.sendStream).toBe(0);
    });
  });

  test("blocks agent access until pairing succeeds", async () => {
    await withTempHome(async (homeDir) => {
      await writeTelegramConfigIni(homeDir, {
        botToken: "1234567890:TEST",
        handshakeCode: "ABCD1234",
      });

      const authStore = new TelegramAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient();
      const sessionStore = new SessionStore(
        path.join(homeDir, ".tinyclaw", "telegram", "chat-sessions.json"),
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
      });

      const { ctx, replies } = createMessageContext({
        userId: 1001,
        text: "Tell me a joke",
      });

      await handleMessage(ctx);

      expect(replies).toHaveLength(1);
      expect(replies[0]).toContain("Paste your pairing code");
      expect(calls.createSession).toBe(0);
      expect(calls.sendStream).toBe(0);
    });
  });

  test("rejects invalid pairing codes without contacting the agent", async () => {
    await withTempHome(async (homeDir) => {
      await writeTelegramConfigIni(homeDir, {
        botToken: "1234567890:TEST",
        handshakeCode: "ABCD1234",
      });

      const authStore = new TelegramAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient();
      const sessionStore = new SessionStore(
        path.join(homeDir, ".tinyclaw", "telegram", "chat-sessions.json"),
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
      });

      const { ctx, replies } = createMessageContext({
        userId: 1001,
        text: "DEADBEEF",
      });

      await handleMessage(ctx);

      expect(replies).toEqual([
        "Invalid pairing code. Copy it from Integrations → Telegram and try again.",
      ]);
      expect(authStore.isAuthorized(1001)).toBe(false);
      expect(calls.sendStream).toBe(0);
    });
  });

  test("pairs a user with a valid code and clears the active handshake", async () => {
    await withTempHome(async (homeDir) => {
      await writeTelegramConfigIni(homeDir, {
        botToken: "1234567890:TEST",
        handshakeCode: "ABCD1234",
      });

      const authStore = new TelegramAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient();
      const sessionStore = new SessionStore(
        path.join(homeDir, ".tinyclaw", "telegram", "chat-sessions.json"),
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
      });

      const pairAttempt = createMessageContext({
        userId: 1001,
        text: "ab cd 12 34",
      });
      await handleMessage(pairAttempt.ctx);

      expect(pairAttempt.replies).toEqual([
        "Linked successfully. You can chat with TinyClaw now.",
      ]);
      expect(authStore.isAuthorized(1001)).toBe(true);
      expect(authStore.getConfig()?.handshakeCode).toBeNull();
      expect(authStore.getConfig()?.pairedUserIds).toEqual([1001]);
      expect(calls.sendStream).toBe(0);

      const chatAttempt = createMessageContext({
        userId: 1001,
        text: "hello agent",
      });
      await handleMessage(chatAttempt.ctx);

      expect(calls.createSession).toBe(1);
      expect(calls.sendStream).toBe(1);
      expect(chatAttempt.replies.at(-1)).toBe("Agent reply");
    });
  });

  test("falls back to the default profile when the configured profile is missing", async () => {
    await withTempHome(async (homeDir) => {
      await writeTelegramConfigIni(homeDir, {
        botToken: "1234567890:TEST",
        handshakeCode: "ABCD1234",
        profileId: "missing_profile",
      });

      const authStore = new TelegramAuthStore();
      await authStore.reload();
      const { client, calls, getLastCreateSessionProfileId } = createMockClient({
        profiles: [{ id: "default", model: null }],
      });
      const sessionStore = new SessionStore(
        path.join(homeDir, ".tinyclaw", "telegram", "chat-sessions.json"),
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "missing_profile" },
        authStore,
        sessionStore,
        orgStore,
      });

      const pairAttempt = createMessageContext({
        userId: 1001,
        text: "ABCD1234",
      });
      await handleMessage(pairAttempt.ctx);

      const chatAttempt = createMessageContext({
        userId: 1001,
        text: "hello agent",
      });
      await handleMessage(chatAttempt.ctx);

      expect(calls.createSession).toBe(1);
      expect(getLastCreateSessionProfileId()).toBe("default");
      expect(chatAttempt.replies.at(-1)).toBe("Agent reply");
    });
  });

  test("does not allow a second user to reuse a consumed pairing code", async () => {
    await withTempHome(async (homeDir) => {
      await writeTelegramConfigIni(homeDir, {
        botToken: "1234567890:TEST",
        handshakeCode: "ABCD1234",
      });

      const authStore = new TelegramAuthStore();
      await authStore.reload();
      const { client } = createMockClient();
      const sessionStore = new SessionStore(
        path.join(homeDir, ".tinyclaw", "telegram", "chat-sessions.json"),
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
      });

      const firstUser = createMessageContext({ userId: 1001, text: "ABCD1234" });
      await handleMessage(firstUser.ctx);

      const secondUser = createMessageContext({ userId: 2002, text: "ABCD1234" });
      await handleMessage(secondUser.ctx);

      expect(secondUser.replies[0]).toContain("not linked yet");
      expect(authStore.isAuthorized(2002)).toBe(false);
      expect(authStore.isAuthorized(1001)).toBe(true);
    });
  });

  test("compacts session history on /compact", async () => {
    await withTempHome(async (homeDir) => {
      await writeTelegramConfigIni(homeDir, {
        botToken: "1234567890:TEST",
        allowedUserIds: [4242],
      });

      const authStore = new TelegramAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient();
      const sessionStore = new SessionStore(
        path.join(homeDir, ".tinyclaw", "telegram", "chat-sessions.json"),
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
      });

      const { ctx, replies } = createMessageContext({
        userId: 4242,
        text: "/compact",
      });

      await handleMessage(ctx);

      expect(calls.compact).toBe(1);
      expect(calls.sendStream).toBe(0);
      expect(replies).toEqual(["Compacted (summarized). Messages: 4."]);
    });
  });

  test("allows pre-approved users to skip pairing", async () => {
    await withTempHome(async (homeDir) => {
      await writeTelegramConfigIni(homeDir, {
        botToken: "1234567890:TEST",
        allowedUserIds: [4242],
      });

      const authStore = new TelegramAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient();
      const sessionStore = new SessionStore(
        path.join(homeDir, ".tinyclaw", "telegram", "chat-sessions.json"),
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
      });

      const { ctx, replies } = createMessageContext({
        userId: 4242,
        text: "hello agent",
      });

      await handleMessage(ctx);

      expect(calls.createSession).toBe(1);
      expect(calls.sendStream).toBe(1);
      expect(replies.at(-1)).toBe("Agent reply");
    });
  });

  test("/stop aborts an in-flight stream without waiting for the chat lock", async () => {
    await withTempHome(async (homeDir) => {
      await writeTelegramConfigIni(homeDir, {
        botToken: "1234567890:TEST",
        allowedUserIds: [4242],
      });

      const authStore = new TelegramAuthStore();
      await authStore.reload();
      const { client, calls, getStreamControl } = createMockClient({ streaming: true });
      const sessionStore = new SessionStore(
        path.join(homeDir, ".tinyclaw", "telegram", "chat-sessions.json"),
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
      });

      const chatAttempt = createMessageContext({
        userId: 4242,
        text: "hello agent",
      });
      const stopAttempt = createMessageContext({
        userId: 4242,
        text: "/stop",
      });

      const chatPromise = handleMessage(chatAttempt.ctx);

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(getStreamControl()?.signal).toBeDefined();

      await handleMessage(stopAttempt.ctx);

      await chatPromise;

      expect(calls.sendStream).toBe(1);
      expect(stopAttempt.replies).toEqual([]);
      expect(chatAttempt.replies).toEqual(["Stopped."]);
    });
  });

  test("/stop with no active stream replies with nothing to stop", async () => {
    await withTempHome(async (homeDir) => {
      await writeTelegramConfigIni(homeDir, {
        botToken: "1234567890:TEST",
        allowedUserIds: [4242],
      });

      const authStore = new TelegramAuthStore();
      await authStore.reload();
      const { client } = createMockClient();
      const sessionStore = new SessionStore(
        path.join(homeDir, ".tinyclaw", "telegram", "chat-sessions.json"),
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
      });

      const { ctx, replies } = createMessageContext({
        userId: 4242,
        text: "/stop",
      });

      await handleMessage(ctx);

      expect(replies).toEqual(["Nothing to stop."]);
    });
  });

  test("shows todo progress in one status message and keeps the final completed state", async () => {
    await withTempHome(async (homeDir) => {
      await writeTelegramConfigIni(homeDir, {
        botToken: "1234567890:TEST",
        allowedUserIds: [4242],
      });

      const authStore = new TelegramAuthStore();
      await authStore.reload();
      const { client } = createMockClient({
        streaming: true,
        steps: [
          {
            type: "todos",
            todos: [
              { id: "plan", content: "Plan changes", status: "in_progress" },
              { id: "ship", content: "Ship update", status: "pending" },
            ],
          },
          {
            type: "todos",
            todos: [
              { id: "plan", content: "Plan changes", status: "completed" },
              { id: "ship", content: "Ship update", status: "completed" },
            ],
          },
          { type: "todos", todos: [] },
          { type: "resolve", reply: "Done" },
        ],
      });
      const sessionStore = new SessionStore(
        path.join(homeDir, ".tinyclaw", "telegram", "chat-sessions.json"),
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
      });

      const { ctx, replies, edits } = createMessageContext({
        userId: 4242,
        text: "hello agent",
      });

      await handleMessage(ctx);

      expect(replies).toHaveLength(2);
      expect(replies[0]).toContain("🛠️ Working");
      expect(replies[0]).toContain("🔄 [~] Plan changes");
      expect(replies[0]).toContain("⏳ [ ] Ship update");
      expect(replies[1]).toBe("Done");
      expect(edits).toHaveLength(2);
      expect(edits[0]).toEqual({
        chatId: 4242,
        messageId: 1,
        text: "🛠️ Working\n✅ [x] Plan changes\n✅ [x] Ship update",
      });
      expect(edits[1]).toEqual({
        chatId: 4242,
        messageId: 1,
        text: "✅ Completed\n✅ [x] Plan changes\n✅ [x] Ship update",
      });
    });
  });

  test("does not create a status message when no todo updates arrive", async () => {
    await withTempHome(async (homeDir) => {
      await writeTelegramConfigIni(homeDir, {
        botToken: "1234567890:TEST",
        allowedUserIds: [4242],
      });

      const authStore = new TelegramAuthStore();
      await authStore.reload();
      const { client } = createMockClient({
        streaming: true,
        steps: [
          { type: "chunk", delta: "Agent " },
          { type: "chunk", delta: "reply" },
          { type: "resolve", reply: "Agent reply" },
        ],
      });
      const sessionStore = new SessionStore(
        path.join(homeDir, ".tinyclaw", "telegram", "chat-sessions.json"),
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
      });

      const { ctx, replies, edits } = createMessageContext({
        userId: 4242,
        text: "hello agent",
      });

      await handleMessage(ctx);

      expect(replies).toEqual(["Agent reply"]);
      expect(edits).toEqual([]);
    });
  });

  test("reuses the same status message when stopping an in-flight run", async () => {
    await withTempHome(async (homeDir) => {
      await writeTelegramConfigIni(homeDir, {
        botToken: "1234567890:TEST",
        allowedUserIds: [4242],
      });

      const authStore = new TelegramAuthStore();
      await authStore.reload();
      const { client } = createMockClient({
        streaming: true,
        autoComplete: false,
        steps: [
          {
            type: "todos",
            todos: [
              { id: "plan", content: "Plan changes", status: "in_progress" },
              { id: "ship", content: "Ship update", status: "pending" },
            ],
          },
        ],
      });
      const sessionStore = new SessionStore(
        path.join(homeDir, ".tinyclaw", "telegram", "chat-sessions.json"),
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
      });

      const chatAttempt = createMessageContext({
        userId: 4242,
        text: "hello agent",
      });
      const stopAttempt = createMessageContext({
        userId: 4242,
        text: "/stop",
      });

      const chatPromise = handleMessage(chatAttempt.ctx);

      await new Promise((resolve) => setTimeout(resolve, 10));
      await handleMessage(stopAttempt.ctx);
      await chatPromise;

      expect(chatAttempt.replies).toEqual([
        "🛠️ Working\n🔄 [~] Plan changes\n⏳ [ ] Ship update",
        "Stopped.",
      ]);
      expect(chatAttempt.edits).toEqual([
        {
          chatId: 4242,
          messageId: 1,
          text: "⏹️ Stopped\n🔄 [~] Plan changes\n⏳ [ ] Ship update",
        },
      ]);
      expect(stopAttempt.replies).toEqual([]);
    });
  });

  test("marks the status message as failed when the stream errors", async () => {
    await withTempHome(async (homeDir) => {
      await writeTelegramConfigIni(homeDir, {
        botToken: "1234567890:TEST",
        allowedUserIds: [4242],
      });

      const authStore = new TelegramAuthStore();
      await authStore.reload();
      const { client } = createMockClient({
        streaming: true,
        steps: [
          {
            type: "todos",
            todos: [
              { id: "plan", content: "Plan changes", status: "in_progress" },
              { id: "ship", content: "Ship update", status: "pending" },
            ],
          },
          { type: "error", message: "Boom" },
        ],
      });
      const sessionStore = new SessionStore(
        path.join(homeDir, ".tinyclaw", "telegram", "chat-sessions.json"),
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
      });

      const { ctx, replies, edits } = createMessageContext({
        userId: 4242,
        text: "hello agent",
      });

      await handleMessage(ctx);

      expect(replies).toEqual([
        "🛠️ Working\n🔄 [~] Plan changes\n⏳ [ ] Ship update",
        "Boom",
      ]);
      expect(edits).toEqual([
        {
          chatId: 4242,
          messageId: 1,
          text: "❌ Failed\n🔄 [~] Plan changes\n⏳ [ ] Ship update",
        },
      ]);
    });
  });

  test("skips redundant edits for identical todo payloads", async () => {
    await withTempHome(async (homeDir) => {
      await writeTelegramConfigIni(homeDir, {
        botToken: "1234567890:TEST",
        allowedUserIds: [4242],
      });

      const authStore = new TelegramAuthStore();
      await authStore.reload();
      const { client } = createMockClient({
        streaming: true,
        steps: [
          {
            type: "todos",
            todos: [
              { id: "plan", content: "Plan changes", status: "in_progress" },
              { id: "ship", content: "Ship update", status: "pending" },
            ],
          },
          {
            type: "todos",
            todos: [
              { id: "plan", content: "Plan changes", status: "in_progress" },
              { id: "ship", content: "Ship update", status: "pending" },
            ],
          },
          { type: "resolve", reply: "Done" },
        ],
      });
      const sessionStore = new SessionStore(
        path.join(homeDir, ".tinyclaw", "telegram", "chat-sessions.json"),
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
      });

      const { ctx, replies, edits } = createMessageContext({
        userId: 4242,
        text: "hello agent",
      });

      await handleMessage(ctx);

      expect(replies).toEqual([
        "🛠️ Working\n🔄 [~] Plan changes\n⏳ [ ] Ship update",
        "Done",
      ]);
      expect(edits).toEqual([
        {
          chatId: 4242,
          messageId: 1,
          text: "✅ Completed\n🔄 [~] Plan changes\n⏳ [ ] Ship update",
        },
      ]);
    });
  });

  test("/start shows pairing prompt before authorization", async () => {
    await withTempHome(async (homeDir) => {
      await writeTelegramConfigIni(homeDir, {
        botToken: "1234567890:TEST",
        handshakeCode: "ABCD1234",
      });

      const authStore = new TelegramAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient();
      const sessionStore = new SessionStore(
        path.join(homeDir, ".tinyclaw", "telegram", "chat-sessions.json"),
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
      });

      const { ctx, replies } = createMessageContext({
        userId: 1001,
        text: "/start",
      });

      await handleMessage(ctx);

      expect(replies).toHaveLength(1);
      expect(replies[0]).toContain("Paste your pairing code");
      expect(calls.sendStream).toBe(0);
    });
  });

  test("/start@botname shows help for authorized users", async () => {
    await withTempHome(async (homeDir) => {
      await writeTelegramConfigIni(homeDir, {
        botToken: "1234567890:TEST",
        allowedUserIds: [4242],
      });

      const authStore = new TelegramAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient();
      const sessionStore = new SessionStore(
        path.join(homeDir, ".tinyclaw", "telegram", "chat-sessions.json"),
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
      });

      const { ctx, replies } = createMessageContext({
        userId: 4242,
        text: "/start@TinyClawBot",
      });

      await handleMessage(ctx);

      expect(calls.sendStream).toBe(0);
      expect(replies.join("\n")).toContain("/help");
      expect(replies.join("\n")).toContain("/start");
    });
  });

  test("prompts for dashboard setup when no pairing code is active", async () => {
    await withTempHome(async (homeDir) => {
      await writeTelegramConfigIni(homeDir, {
        botToken: "1234567890:TEST",
      });

      const authStore = new TelegramAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient();
      const sessionStore = new SessionStore(
        path.join(homeDir, ".tinyclaw", "telegram", "chat-sessions.json"),
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
      });

      const { ctx, replies } = createMessageContext({
        userId: 1001,
        text: "ABCD1234",
      });

      await handleMessage(ctx);

      expect(replies[0]).toContain("not linked yet");
      expect(calls.sendStream).toBe(0);
    });
  });
});

describe("bridge API integration", () => {
  test("calls org and profile APIs before creating a chat session", async () => {
    await withTempHome(async (homeDir) => {
      await writeTelegramConfigIni(homeDir, {
        botToken: "1234567890:TEST",
        pairedUserIds: [1001],
      });

      const authStore = new TelegramAuthStore();
      await authStore.reload();
      const { client, calls, orgIds } = createMockClient();
      const sessionStore = new SessionStore(
        path.join(homeDir, ".tinyclaw", "telegram", "chat-sessions.json"),
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
      });

      const { ctx } = createMessageContext({ userId: 1001, text: "hello" });
      await handleMessage(ctx);

      expect(calls.listUserOrgs).toBeGreaterThanOrEqual(1);
      expect(calls.setOrgId).toBeGreaterThanOrEqual(1);
      expect(orgIds).toContain("org_test");
      expect(calls.listProfiles).toBeGreaterThanOrEqual(1);
      expect(calls.createSession).toBe(1);
      expect(calls.sendStream).toBe(1);
    });
  });

  test("auto-selects a single org without prompting", async () => {
    await withTempHome(async (homeDir) => {
      await writeTelegramConfigIni(homeDir, {
        botToken: "1234567890:TEST",
        pairedUserIds: [1001],
      });

      const authStore = new TelegramAuthStore();
      await authStore.reload();
      const { client } = createMockClient();
      const sessionStore = new SessionStore(
        path.join(homeDir, ".tinyclaw", "telegram", "chat-sessions.json"),
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
      });

      const { ctx, replies } = createMessageContext({ userId: 1001, text: "hello" });
      await handleMessage(ctx);

      expect(replies.some((reply) => reply.includes("Choose an organization"))).toBe(false);
      expect(orgStore.get("1001")?.orgId).toBe("org_test");
    });
  });

  test("prompts for org selection when multiple orgs exist", async () => {
    await withTempHome(async (homeDir) => {
      await writeTelegramConfigIni(homeDir, {
        botToken: "1234567890:TEST",
        pairedUserIds: [1001],
      });

      const authStore = new TelegramAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient({ orgs: createMultiTestOrgs() });
      const sessionStore = new SessionStore(
        path.join(homeDir, ".tinyclaw", "telegram", "chat-sessions.json"),
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
      });

      const { ctx, replies } = createMessageContext({ userId: 1001, text: "hello" });
      await handleMessage(ctx);

      expect(replies.join("\n")).toContain("Choose an organization");
      expect(calls.createSession).toBe(0);
      expect(calls.sendStream).toBe(0);
    });
  });

  test("continues chatting after the user selects an org", async () => {
    await withTempHome(async (homeDir) => {
      await writeTelegramConfigIni(homeDir, {
        botToken: "1234567890:TEST",
        pairedUserIds: [1001],
      });

      const authStore = new TelegramAuthStore();
      await authStore.reload();
      const { client, calls, orgIds } = createMockClient({ orgs: createMultiTestOrgs() });
      const sessionStore = new SessionStore(
        path.join(homeDir, ".tinyclaw", "telegram", "chat-sessions.json"),
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
      });

      const pick = createMessageContext({ userId: 1001, text: "2" });
      await handleMessage(pick.ctx);

      expect(orgIds).toContain("org_b");
      expect(pick.replies.join("\n")).toContain("Now using Beta");

      const chat = createMessageContext({ userId: 1001, text: "hello" });
      await handleMessage(chat.ctx);

      expect(calls.createSession).toBe(1);
      expect(calls.sendStream).toBe(1);
    });
  });

  test("/profile lists profiles for the active org", async () => {
    await withTempHome(async (homeDir) => {
      await writeTelegramConfigIni(homeDir, {
        botToken: "1234567890:TEST",
        pairedUserIds: [1001],
      });

      const authStore = new TelegramAuthStore();
      await authStore.reload();
      const { client } = createMockClient({
        profiles: [
          { id: "default", name: "Default Bot", isDefault: true },
          { id: "research", name: "Research Bot" },
        ],
      });
      const sessionStore = new SessionStore(
        path.join(homeDir, ".tinyclaw", "telegram", "chat-sessions.json"),
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
      });

      const { ctx, replies } = createMessageContext({ userId: 1001, text: "/profile" });
      await handleMessage(ctx);

      expect(replies.join("\n")).toContain("Choose a profile");
      expect(replies.join("\n")).toContain("Default Bot");
      expect(replies.join("\n")).toContain("Research Bot");
    });
  });

  test("/profile hides super bot from channel profile switches", async () => {
    await withTempHome(async (homeDir) => {
      await writeTelegramConfigIni(homeDir, {
        botToken: "1234567890:TEST",
        pairedUserIds: [1001],
      });

      const authStore = new TelegramAuthStore();
      await authStore.reload();
      const { client } = createMockClient({
        profiles: [
          { id: "default", name: "Default Bot", isDefault: true },
          { id: "super_bot", name: "Super Bot", isSuper: true },
        ],
      });
      const sessionStore = new SessionStore(
        path.join(homeDir, ".tinyclaw", "telegram", "chat-sessions.json"),
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
      });

      const { ctx, replies } = createMessageContext({ userId: 1001, text: "/profile" });
      await handleMessage(ctx);

      const text = replies.join("\n");
      expect(text).toContain("Default Bot");
      expect(text).not.toContain("Super Bot");
    });
  });

  test("/profile switches bot and starts a fresh session", async () => {
    await withTempHome(async (homeDir) => {
      await writeTelegramConfigIni(homeDir, {
        botToken: "1234567890:TEST",
        pairedUserIds: [1001],
      });

      const authStore = new TelegramAuthStore();
      await authStore.reload();
      const { client, calls, getLastCreateSessionProfileId } = createMockClient({
        profiles: [
          { id: "default", name: "Default Bot", isDefault: true },
          { id: "research", name: "Research Bot" },
        ],
      });
      const sessionStore = new SessionStore(
        path.join(homeDir, ".tinyclaw", "telegram", "chat-sessions.json"),
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
      });

      const chat = createMessageContext({ userId: 1001, text: "hello" });
      await handleMessage(chat.ctx);
      expect(getLastCreateSessionProfileId()).toBe("default");

      const switchProfile = createMessageContext({
        userId: 1001,
        text: "/profile research",
      });
      await handleMessage(switchProfile.ctx);

      expect(calls.createSession).toBe(2);
      expect(getLastCreateSessionProfileId()).toBe("research");
      expect(switchProfile.replies).toEqual([
        "Now using Research Bot. Chat history reset.",
      ]);
      expect(sessionStore.get("1001")?.profileId).toBe("research");
    });
  });

  test("/profile switches org when the profile lives in another org", async () => {
    await withTempHome(async (homeDir) => {
      await writeTelegramConfigIni(homeDir, {
        botToken: "1234567890:TEST",
        pairedUserIds: [1001],
      });

      const authStore = new TelegramAuthStore();
      await authStore.reload();
      const { client, getLastCreateSessionProfileId } = createMockClient({
        orgs: createMultiTestOrgs(),
        profilesByOrgId: {
          org_a: [{ id: "default", name: "Default Bot", isDefault: true }],
          org_b: [{ id: "gary", name: "Gary Vee", isDefault: true }],
        },
      });
      const sessionStore = new SessionStore(
        path.join(homeDir, ".tinyclaw", "telegram", "chat-sessions.json"),
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      orgStore.set("1001", "org_a");
      await orgStore.save();
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
      });

      const switchProfile = createMessageContext({
        userId: 1001,
        text: "/profile garry-vee",
      });
      await handleMessage(switchProfile.ctx);

      expect(orgStore.get("1001")?.orgId).toBe("org_b");
      expect(getLastCreateSessionProfileId()).toBe("gary");
      expect(switchProfile.replies).toEqual([
        "Now using Gary Vee. Chat history reset. (Beta)",
      ]);
    });
  });

  test("/profile accepts the visible list number in the current org", async () => {
    await withTempHome(async (homeDir) => {
      await writeTelegramConfigIni(homeDir, {
        botToken: "1234567890:TEST",
        pairedUserIds: [1001],
      });

      const authStore = new TelegramAuthStore();
      await authStore.reload();
      const { client, getLastCreateSessionProfileId } = createMockClient({
        orgs: createMultiTestOrgs(),
        profilesByOrgId: {
          org_a: [
            { id: "default", name: "Default Bot", isDefault: true },
            { id: "research", name: "Research Bot" },
          ],
          org_b: [
            { id: "writer", name: "Writer Bot", isDefault: true },
            { id: "gary", name: "Gary Vee" },
          ],
        },
      });
      const sessionStore = new SessionStore(
        path.join(homeDir, ".tinyclaw", "telegram", "chat-sessions.json"),
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      orgStore.set("1001", "org_a");
      await orgStore.save();
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
      });

      const switchProfile = createMessageContext({
        userId: 1001,
        text: "/profile 2",
      });
      await handleMessage(switchProfile.ctx);

      expect(orgStore.get("1001")?.orgId).toBe("org_a");
      expect(getLastCreateSessionProfileId()).toBe("research");
      expect(switchProfile.replies).toEqual([
        "Now using Research Bot. Chat history reset.",
      ]);
    });
  });
});

describe("createChatHandler document attachments", () => {
  let fetchSpy: ReturnType<typeof spyOn> | undefined;

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  function createDocumentContext(options: {
    userId: number;
    fileName: string;
    mimeType: string;
    caption?: string;
  }) {
    const base = createMessageContext({ userId: options.userId });
    (base.ctx as { message: Record<string, unknown> }).message = {
      document: {
        file_id: "doc-1",
        file_name: options.fileName,
        mime_type: options.mimeType,
      },
      caption: options.caption,
    };
    (base.ctx as { api: Record<string, unknown> }).api = {
      ...((base.ctx as { api?: Record<string, unknown> }).api ?? {}),
      token: "test-token",
      getFile: async () => ({ file_path: `documents/${options.fileName}` }),
    };

    return base;
  }

  test("forwards supported pdf documents to sendStream", async () => {
    await withTempHome(async (homeDir) => {
      await writeTelegramConfigIni(homeDir, {
        botToken: "1234567890:TEST",
        allowedUserIds: [4242],
      });

      fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("pdf-content", {
          headers: { "content-type": "application/pdf" },
        }),
      );

      const authStore = new TelegramAuthStore();
      await authStore.reload();
      const { client, calls, getLastStreamInput } = createMockClient();
      const sessionStore = new SessionStore(
        path.join(homeDir, ".tinyclaw", "telegram", "chat-sessions.json"),
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
      });

      const { ctx, replies } = createDocumentContext({
        userId: 4242,
        fileName: "report.pdf",
        mimeType: "application/pdf",
        caption: "Summarize",
      });

      await handleMessage(ctx);

      expect(calls.sendStream).toBe(1);
      expect(getLastStreamInput()).toEqual({
        message: "Summarize",
        documents: [
          expect.objectContaining({
            filename: "report.pdf",
            mediaType: "application/pdf",
          }),
        ],
      });
      expect(replies.at(-1)).toBe("Agent reply");
    });
  });

  test("rejects unsupported documents without calling sendStream", async () => {
    await withTempHome(async (homeDir) => {
      await writeTelegramConfigIni(homeDir, {
        botToken: "1234567890:TEST",
        allowedUserIds: [4242],
      });

      fetchSpy = spyOn(globalThis, "fetch");

      const authStore = new TelegramAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient();
      const sessionStore = new SessionStore(
        path.join(homeDir, ".tinyclaw", "telegram", "chat-sessions.json"),
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
      });

      const { ctx, replies } = createDocumentContext({
        userId: 4242,
        fileName: "sheet.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

      await handleMessage(ctx);

      expect(calls.sendStream).toBe(0);
      expect(replies).toEqual([UNSUPPORTED_DOCUMENT_TYPES_REPLY]);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  test("replies with supported media guidance for other non-text messages", async () => {
    await withTempHome(async (homeDir) => {
      await writeTelegramConfigIni(homeDir, {
        botToken: "1234567890:TEST",
        allowedUserIds: [4242],
      });

      const authStore = new TelegramAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient();
      const sessionStore = new SessionStore(
        path.join(homeDir, ".tinyclaw", "telegram", "chat-sessions.json"),
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
      });

      const { ctx, replies } = createMessageContext({ userId: 4242 });
      (ctx as { message: Record<string, unknown> }).message = {
        voice: { file_id: "voice-1" },
      };

      await handleMessage(ctx);

      expect(calls.sendStream).toBe(0);
      expect(replies).toEqual([UNSUPPORTED_MEDIA_REPLY]);
    });
  });
});
