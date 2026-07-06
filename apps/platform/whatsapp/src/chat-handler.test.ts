import path from "node:path";
import { describe, expect, test } from "bun:test";
import { WhatsAppAuthStore } from "./auth-store";
import { createChatHandler } from "./chat-handler";
import { SessionStore } from "./session-store";
import {
  createDefaultTestOrgs,
  createMockClient,
  createMultiTestOrgs,
  createTestOrgStore,
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
      const { client, calls } = createMockClient({
        profiles: [
          {
            id: "default",
            name: "Default",
            model: null,
            isSuper: false,
            toolCount: 0,
            mcpServerCount: 0,
            soulActive: false,
            hasAvatar: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          {
            id: "profile_tensetutor",
            name: "Tense Tutor",
            model: null,
            isSuper: false,
            toolCount: 0,
            mcpServerCount: 0,
            soulActive: false,
            hasAvatar: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      });
      const sessionStore = new SessionStore(
        path.join(homeDir, ".nakama", "whatsapp", "chat-sessions.json"),
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const { socket, sent } = createMockSocket();

      const handleMessage = createChatHandler({
        client,
        config: { phoneNumber: "1234567890", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
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
      const { client, calls } = createMockClient({
        profiles: [
          {
            id: "default",
            name: "Default",
            model: null,
            isSuper: false,
            toolCount: 0,
            mcpServerCount: 0,
            soulActive: false,
            hasAvatar: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          {
            id: "profile_tensetutor",
            name: "Tense Tutor",
            model: null,
            isSuper: false,
            toolCount: 0,
            mcpServerCount: 0,
            soulActive: false,
            hasAvatar: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      });
      const sessionStore = new SessionStore(
        path.join(homeDir, ".nakama", "whatsapp", "chat-sessions.json"),
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const { socket, sent } = createMockSocket();

      const handleMessage = createChatHandler({
        client,
        config: { phoneNumber: "1234567890", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
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
      const { client, calls } = createMockClient({
        profiles: [
          {
            id: "default",
            name: "Default",
            model: null,
            isSuper: false,
            toolCount: 0,
            mcpServerCount: 0,
            soulActive: false,
            hasAvatar: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          {
            id: "profile_tensetutor",
            name: "Tense Tutor",
            model: null,
            isSuper: false,
            toolCount: 0,
            mcpServerCount: 0,
            soulActive: false,
            hasAvatar: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      });
      const sessionStore = new SessionStore(
        path.join(homeDir, ".nakama", "whatsapp", "chat-sessions.json"),
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const { socket, sent } = createMockSocket();

      const handleMessage = createChatHandler({
        client,
        config: { phoneNumber: "1234567890", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
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
      const { client, calls } = createMockClient({
        profiles: [
          {
            id: "default",
            name: "Default",
            model: null,
            isSuper: false,
            toolCount: 0,
            mcpServerCount: 0,
            soulActive: false,
            hasAvatar: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          {
            id: "profile_tensetutor",
            name: "Tense Tutor",
            model: null,
            isSuper: false,
            toolCount: 0,
            mcpServerCount: 0,
            soulActive: false,
            hasAvatar: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      });
      const sessionStore = new SessionStore(
        path.join(homeDir, ".nakama", "whatsapp", "chat-sessions.json"),
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const { socket } = createMockSocket();

      const handleMessage = createChatHandler({
        client,
        config: { phoneNumber: "1234567890", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
        getSocket: () => socket as any,
      });

      await handleMessage({ jid: PAIRED_JID, text: "hello agent" });

      expect(calls.createSession).toBe(1);
      expect(calls.sendStream).toBe(1);
    });
  });

  test("allows device-suffixed inbound JID for a paired phone JID", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        phoneNumber: "6281379292556",
        pairedJid: "6281379292556@s.whatsapp.net",
      });

      const authStore = new WhatsAppAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient({
        profiles: [
          {
            id: "default",
            name: "Default",
            model: null,
            isSuper: false,
            toolCount: 0,
            mcpServerCount: 0,
            soulActive: false,
            hasAvatar: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          {
            id: "profile_tensetutor",
            name: "Tense Tutor",
            model: null,
            isSuper: false,
            toolCount: 0,
            mcpServerCount: 0,
            soulActive: false,
            hasAvatar: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      });
      const sessionStore = new SessionStore(
        path.join(homeDir, ".nakama", "whatsapp", "chat-sessions.json"),
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const { socket } = createMockSocket();

      const handleMessage = createChatHandler({
        client,
        config: { phoneNumber: "6281379292556", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
        getSocket: () => socket as any,
      });

      await handleMessage({ jid: "6281379292556:12@s.whatsapp.net", text: "hello agent" });

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
        path.join(homeDir, ".nakama", "whatsapp", "chat-sessions.json"),
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const { socket, sent } = createMockSocket();

      const handleMessage = createChatHandler({
        client,
        config: { phoneNumber: "1234567890", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
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
        path.join(homeDir, ".nakama", "whatsapp", "chat-sessions.json"),
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const { socket, sent } = createMockSocket();

      const handleMessage = createChatHandler({
        client,
        config: { phoneNumber: "1234567890", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
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
        path.join(homeDir, ".nakama", "whatsapp", "chat-sessions.json"),
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const { socket, sent } = createMockSocket();

      const handleMessage = createChatHandler({
        client,
        config: { phoneNumber: "1234567890", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
        getSocket: () => socket as any,
      });

      await handleMessage({ jid: PAIRED_JID, text: "/compact" });

      expect(calls.compact).toBe(1);
      expect(sent.length).toBe(1);
      expect(sent[0].text).toContain("Compacted");
    });
  });

  test("/stop aborts an in-flight stream without waiting for the chat lock", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        phoneNumber: "1234567890",
        pairedJid: PAIRED_JID,
      });

      const authStore = new WhatsAppAuthStore();
      await authStore.reload();
      const { client, calls, getStreamControl } = createMockClient({ streaming: true });
      const sessionStore = new SessionStore(
        path.join(homeDir, ".nakama", "whatsapp", "chat-sessions.json"),
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const { socket, sent } = createMockSocket();

      const handleMessage = createChatHandler({
        client,
        config: { phoneNumber: "1234567890", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
        getSocket: () => socket as any,
      });

      const chatPromise = handleMessage({ jid: PAIRED_JID, text: "hello agent" });

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(getStreamControl()?.signal).toBeDefined();

      await handleMessage({ jid: PAIRED_JID, text: "/stop" });

      await chatPromise;

      expect(calls.sendStream).toBe(1);
      expect(sent.map((message) => message.text)).toEqual(["Stopped."]);
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
        path.join(homeDir, ".nakama", "whatsapp", "chat-sessions.json"),
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const { socket, sent } = createMockSocket();

      const handleMessage = createChatHandler({
        client,
        config: { phoneNumber: "1234567890", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
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
        path.join(homeDir, ".nakama", "whatsapp", "chat-sessions.json"),
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const { socket, sent } = createMockSocket();

      const handleMessage = createChatHandler({
        client,
        config: { phoneNumber: "1234567890", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
        getSocket: () => socket as any,
      });

      await handleMessage({ jid: PAIRED_JID, text: "/unknown" });

      expect(sent.length).toBe(1);
      expect(sent[0].text).toContain("Unknown command");
      expect(calls.sendStream).toBe(0);
    });
  });

  test("falls back to an existing profile when config points to a missing one", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        phoneNumber: "1234567890",
        profileId: "missing_profile",
        pairedJid: PAIRED_JID,
      });

      const authStore = new WhatsAppAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient({
        profiles: [
          {
            id: "profile_tensetutor",
            name: "Tense Tutor",
            model: null,
            isSuper: false,
            toolCount: 0,
            mcpServerCount: 0,
            soulActive: false,
            hasAvatar: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      });
      const sessionStore = new SessionStore(
        path.join(homeDir, ".nakama", "whatsapp", "chat-sessions.json"),
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const { socket, sent } = createMockSocket();

      const handleMessage = createChatHandler({
        client,
        config: { phoneNumber: "1234567890", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
        getSocket: () => socket as any,
      });

      await handleMessage({ jid: PAIRED_JID, text: "/new" });

      expect(calls.listProfiles).toBe(1);
      expect(calls.profileIds).toEqual(["profile_tensetutor"]);
      expect(sent[0]?.text).toContain("Started a new conversation.");
    });
  });
});

describe("bridge API integration", () => {
  test("calls org and profile APIs before creating a chat session", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        phoneNumber: "1234567890",
        pairedJid: PAIRED_JID,
      });

      const authStore = new WhatsAppAuthStore();
      await authStore.reload();
      const { client, calls, orgIds } = createMockClient();
      const sessionStore = new SessionStore(
        path.join(homeDir, ".nakama", "whatsapp", "chat-sessions.json"),
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const { socket } = createMockSocket();
      const handleMessage = createChatHandler({
        client,
        config: { phoneNumber: "1234567890", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
        getSocket: () => socket as any,
      });

      await handleMessage({ jid: PAIRED_JID, text: "hello" });

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
      await writeWhatsAppConfigIni(homeDir, {
        phoneNumber: "1234567890",
        pairedJid: PAIRED_JID,
      });

      const authStore = new WhatsAppAuthStore();
      await authStore.reload();
      const { client } = createMockClient();
      const sessionStore = new SessionStore(
        path.join(homeDir, ".nakama", "whatsapp", "chat-sessions.json"),
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const { socket, sent } = createMockSocket();
      const handleMessage = createChatHandler({
        client,
        config: { phoneNumber: "1234567890", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
        getSocket: () => socket as any,
      });

      await handleMessage({ jid: PAIRED_JID, text: "hello" });

      expect(sent.some((message) => message.text.includes("Choose an organization"))).toBe(
        false,
      );
      expect(orgStore.get(PAIRED_JID)?.orgId).toBe("org_test");
    });
  });

  test("prompts for org selection when multiple orgs exist", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        phoneNumber: "1234567890",
        pairedJid: PAIRED_JID,
      });

      const authStore = new WhatsAppAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient({ orgs: createMultiTestOrgs() });
      const sessionStore = new SessionStore(
        path.join(homeDir, ".nakama", "whatsapp", "chat-sessions.json"),
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const { socket, sent } = createMockSocket();
      const handleMessage = createChatHandler({
        client,
        config: { phoneNumber: "1234567890", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
        getSocket: () => socket as any,
      });

      await handleMessage({ jid: PAIRED_JID, text: "hello" });

      expect(sent.some((message) => message.text.includes("Choose an organization"))).toBe(true);
      expect(calls.createSession).toBe(0);
      expect(calls.sendStream).toBe(0);
    });
  });

  test("continues chatting after the user selects an org", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        phoneNumber: "1234567890",
        pairedJid: PAIRED_JID,
      });

      const authStore = new WhatsAppAuthStore();
      await authStore.reload();
      const { client, calls, orgIds } = createMockClient({ orgs: createMultiTestOrgs() });
      const sessionStore = new SessionStore(
        path.join(homeDir, ".nakama", "whatsapp", "chat-sessions.json"),
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const { socket, sent } = createMockSocket();
      const handleMessage = createChatHandler({
        client,
        config: { phoneNumber: "1234567890", profileId: "default" },
        authStore,
        sessionStore,
        orgStore,
        getSocket: () => socket as any,
      });

      await handleMessage({ jid: PAIRED_JID, text: "2" });
      expect(orgIds).toContain("org_b");
      expect(sent.some((message) => message.text.includes("Now using Beta"))).toBe(true);

      await handleMessage({ jid: PAIRED_JID, text: "hello" });
      expect(calls.createSession).toBe(1);
      expect(calls.sendStream).toBe(1);
    });
  });
});
