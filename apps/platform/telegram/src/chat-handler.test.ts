import path from "node:path";
import { describe, expect, test } from "bun:test";
import { TelegramAuthStore } from "./auth-store";
import { createChatHandler } from "./chat-handler";
import { SessionStore } from "./session-store";
import {
  createMessageContext,
  createMockClient,
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
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "default" },
        authStore,
        sessionStore,
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
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "default" },
        authStore,
        sessionStore,
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
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "default" },
        authStore,
        sessionStore,
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
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "default" },
        authStore,
        sessionStore,
      });

      const { ctx, replies } = createMessageContext({
        userId: 1001,
        text: "DEADBEEF",
      });

      await handleMessage(ctx);

      expect(replies).toEqual([
        "Invalid pairing code. Copy it from Settings → Telegram and try again.",
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
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "default" },
        authStore,
        sessionStore,
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
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "missing_profile" },
        authStore,
        sessionStore,
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
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "default" },
        authStore,
        sessionStore,
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
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "default" },
        authStore,
        sessionStore,
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
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "default" },
        authStore,
        sessionStore,
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
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "default" },
        authStore,
        sessionStore,
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
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "default" },
        authStore,
        sessionStore,
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
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "default" },
        authStore,
        sessionStore,
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
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "default" },
        authStore,
        sessionStore,
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
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "default" },
        authStore,
        sessionStore,
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
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "default" },
        authStore,
        sessionStore,
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
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "default" },
        authStore,
        sessionStore,
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
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "default" },
        authStore,
        sessionStore,
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
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "default" },
        authStore,
        sessionStore,
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
      const handleMessage = createChatHandler({
        client,
        config: { botToken: "1234567890:TEST", profileId: "default" },
        authStore,
        sessionStore,
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
