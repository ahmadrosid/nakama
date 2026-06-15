import path from "node:path";
import { describe, expect, test } from "bun:test";
import { WhatsAppAuthStore } from "./auth-store";
import { createChatHandler } from "./chat-handler";
import { SessionStore } from "./session-store";
import {
  createMockClient,
  withTempHome,
  writeWhatsAppConfigIni,
} from "./test-helpers";

const PAIRED_JID = "1234567890@s.whatsapp.net";

function createMockSocket() {
  const sent: Array<{ jid: string; text: string }> = [];

  const socket = {
    sendMessage: async (jid: string, content: { text: string }) => {
      sent.push({ jid, text: content.text });
    },
    sendPresenceUpdate: async () => {},
    ev: {
      on: () => {},
      off: () => {},
    },
    end: () => {},
  };

  return { socket, sent };
}

describe("createChatHandler", () => {
  test("blocks unauthorized JID from chatting", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        phoneNumber: "1234567890",
        pairingCode: "ABCD1234",
      });

      const authStore = new WhatsAppAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient();
      const sessionStore = new SessionStore(
        path.join(homeDir, ".tinyclaw", "whatsapp", "chat-sessions.json"),
      );
      const { socket, sent } = createMockSocket();

      const handleMessage = createChatHandler({
        client,
        config: { phoneNumber: "1234567890", profileId: "profile_default" },
        authStore,
        sessionStore,
        getSocket: () => socket as any,
      });

      await handleMessage({ jid: "9999999999@s.whatsapp.net", text: "hello" });

      expect(sent.length).toBeGreaterThanOrEqual(1);
      expect(calls.createSession).toBe(0);
      expect(calls.sendStream).toBe(0);
    });
  });

  test("rejects invalid pairing codes", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        phoneNumber: "1234567890",
        pairingCode: "ABCD1234",
      });

      const authStore = new WhatsAppAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient();
      const sessionStore = new SessionStore(
        path.join(homeDir, ".tinyclaw", "whatsapp", "chat-sessions.json"),
      );
      const { socket, sent } = createMockSocket();

      const handleMessage = createChatHandler({
        client,
        config: { phoneNumber: "1234567890", profileId: "profile_default" },
        authStore,
        sessionStore,
        getSocket: () => socket as any,
      });

      await handleMessage({ jid: "9999999999@s.whatsapp.net", text: "WRONG" });

      expect(sent.length).toBe(1);
      expect(sent[0].text).toContain("Invalid pairing code");
      expect(calls.sendStream).toBe(0);
    });
  });

  test("pairs a JID with a valid code and allows chatting", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        phoneNumber: "1234567890",
        pairingCode: "ABCD1234",
      });

      const authStore = new WhatsAppAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient();
      const sessionStore = new SessionStore(
        path.join(homeDir, ".tinyclaw", "whatsapp", "chat-sessions.json"),
      );
      const { socket, sent } = createMockSocket();

      const handleMessage = createChatHandler({
        client,
        config: { phoneNumber: "1234567890", profileId: "profile_default" },
        authStore,
        sessionStore,
        getSocket: () => socket as any,
      });

      const pairJid = "1234567890@s.whatsapp.net";
      await handleMessage({ jid: pairJid, text: "ABCD1234" });

      expect(sent.length).toBe(1);
      expect(sent[0].text).toContain("Linked successfully");
      expect(authStore.isAuthorized(pairJid)).toBe(true);

      await handleMessage({ jid: pairJid, text: "hello agent" });
      expect(calls.createSession).toBe(1);
      expect(calls.sendStream).toBe(1);
    });
  });

  test("allows pre-paired JID to chat directly", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        phoneNumber: "1234567890",
        pairedJid: PAIRED_JID,
      });

      const authStore = new WhatsAppAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient();
      const sessionStore = new SessionStore(
        path.join(homeDir, ".tinyclaw", "whatsapp", "chat-sessions.json"),
      );
      const { socket } = createMockSocket();

      const handleMessage = createChatHandler({
        client,
        config: { phoneNumber: "1234567890", profileId: "profile_default" },
        authStore,
        sessionStore,
        getSocket: () => socket as any,
      });

      await handleMessage({ jid: PAIRED_JID, text: "hello agent" });

      expect(calls.createSession).toBe(1);
      expect(calls.sendStream).toBe(1);
    });
  });

  test("handles /help command for authorized JID", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        phoneNumber: "1234567890",
        pairedJid: PAIRED_JID,
      });

      const authStore = new WhatsAppAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient();
      const sessionStore = new SessionStore(
        path.join(homeDir, ".tinyclaw", "whatsapp", "chat-sessions.json"),
      );
      const { socket, sent } = createMockSocket();

      const handleMessage = createChatHandler({
        client,
        config: { phoneNumber: "1234567890", profileId: "profile_default" },
        authStore,
        sessionStore,
        getSocket: () => socket as any,
      });

      await handleMessage({ jid: PAIRED_JID, text: "/help" });

      expect(sent.length).toBe(1);
      expect(sent[0].text).toContain("/help");
      expect(calls.sendStream).toBe(0);
    });
  });

  test("handles /clear command", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        phoneNumber: "1234567890",
        pairedJid: PAIRED_JID,
      });

      const authStore = new WhatsAppAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient();
      const sessionStore = new SessionStore(
        path.join(homeDir, ".tinyclaw", "whatsapp", "chat-sessions.json"),
      );
      const { socket, sent } = createMockSocket();

      const handleMessage = createChatHandler({
        client,
        config: { phoneNumber: "1234567890", profileId: "profile_default" },
        authStore,
        sessionStore,
        getSocket: () => socket as any,
      });

      await handleMessage({ jid: PAIRED_JID, text: "/clear" });

      expect(calls.compact).toBe(0);
      expect(sent.length).toBe(1);
      expect(sent[0].text).toBe("History cleared.");
    });
  });

  test("handles /compact command", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        phoneNumber: "1234567890",
        pairedJid: PAIRED_JID,
      });

      const authStore = new WhatsAppAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient();
      const sessionStore = new SessionStore(
        path.join(homeDir, ".tinyclaw", "whatsapp", "chat-sessions.json"),
      );
      const { socket, sent } = createMockSocket();

      const handleMessage = createChatHandler({
        client,
        config: { phoneNumber: "1234567890", profileId: "profile_default" },
        authStore,
        sessionStore,
        getSocket: () => socket as any,
      });

      await handleMessage({ jid: PAIRED_JID, text: "/compact" });

      expect(calls.compact).toBe(1);
      expect(sent.length).toBe(1);
      expect(sent[0].text).toContain("Compacted");
    });
  });

  test("/stop with no active stream replies nothing to stop", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        phoneNumber: "1234567890",
        pairedJid: PAIRED_JID,
      });

      const authStore = new WhatsAppAuthStore();
      await authStore.reload();
      const { client } = createMockClient();
      const sessionStore = new SessionStore(
        path.join(homeDir, ".tinyclaw", "whatsapp", "chat-sessions.json"),
      );
      const { socket, sent } = createMockSocket();

      const handleMessage = createChatHandler({
        client,
        config: { phoneNumber: "1234567890", profileId: "profile_default" },
        authStore,
        sessionStore,
        getSocket: () => socket as any,
      });

      await handleMessage({ jid: PAIRED_JID, text: "/stop" });

      expect(sent.length).toBe(1);
      expect(sent[0].text).toBe("Nothing to stop.");
    });
  });

  test("unknown commands return help text", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        phoneNumber: "1234567890",
        pairedJid: PAIRED_JID,
      });

      const authStore = new WhatsAppAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient();
      const sessionStore = new SessionStore(
        path.join(homeDir, ".tinyclaw", "whatsapp", "chat-sessions.json"),
      );
      const { socket, sent } = createMockSocket();

      const handleMessage = createChatHandler({
        client,
        config: { phoneNumber: "1234567890", profileId: "profile_default" },
        authStore,
        sessionStore,
        getSocket: () => socket as any,
      });

      await handleMessage({ jid: PAIRED_JID, text: "/unknown" });

      expect(sent.length).toBe(1);
      expect(sent[0].text).toContain("Unknown command");
      expect(calls.sendStream).toBe(0);
    });
  });

  test("uses updated profile from config on the next message", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        phoneNumber: "1234567890",
        profileId: "profile_default",
        pairedJid: PAIRED_JID,
      });

      const authStore = new WhatsAppAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient();
      const sessionStore = new SessionStore(
        path.join(homeDir, ".tinyclaw", "whatsapp", "chat-sessions.json"),
      );
      const { socket } = createMockSocket();

      const handleMessage = createChatHandler({
        client,
        config: { phoneNumber: "1234567890", profileId: "profile_default" },
        authStore,
        sessionStore,
        getSocket: () => socket as any,
      });

      await handleMessage({ jid: PAIRED_JID, text: "hello" });
      expect(calls.profileIds).toEqual(["profile_default"]);

      await writeWhatsAppConfigIni(homeDir, {
        phoneNumber: "1234567890",
        profileId: "profile_tensetutor",
        pairedJid: PAIRED_JID,
      });

      await handleMessage({ jid: PAIRED_JID, text: "hello again" });
      expect(calls.profileIds).toEqual(["profile_default", "profile_tensetutor"]);
    });
  });
});