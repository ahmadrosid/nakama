import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import path from "node:path";
import { resetActiveStreamsForTests } from "@nakama/core/channel-active-stream";
import { WhatsAppAuthStore } from "./auth-store";
import { createChatHandler, resetChatLocksForTests } from "./chat-handler";
import { SessionStore } from "./session-store";
import {
  createMockClient,
  createMultiTestOrgs,
  createTestOrgStore,
  waitForStreamControl,
  withTempHome,
  writeWhatsAppConfigIni,
} from "./test-helpers";

const PAIRED_JID = "1234567890@s.whatsapp.net";

function createMockSocket() {
  const sent: Array<{
    jid: string;
    text: string;
    content: Record<string, unknown>;
  }> = [];

  const socket = {
    end: () => {},
    ev: {
      off: () => {},
      on: () => {},
    },
    sendMessage: async (jid: string, content: Record<string, unknown>) => {
      sent.push({
        content,
        jid,
        text: typeof content.text === "string" ? content.text : "",
      });
    },
    sendPresenceUpdate: async () => {},
  };

  return { sent, socket };
}

function documentSendCount(
  sent: Array<{ content: Record<string, unknown> }>
): number {
  return sent.filter((entry) => entry.content.document !== undefined).length;
}

beforeEach(() => {
  resetActiveStreamsForTests();
  resetChatLocksForTests();
});

describe("createChatHandler", () => {
  test("blocks unauthorized JID from chatting", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        pairingCode: "ABCD1234",
        phoneNumber: "1234567890",
      });

      const authStore = new WhatsAppAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient({
        profiles: [
          {
            createdAt: new Date().toISOString(),
            hasAvatar: false,
            id: "default",
            isSuper: false,
            mcpServerCount: 0,
            model: null,
            name: "Default",
            soulActive: false,
            toolCount: 0,
            updatedAt: new Date().toISOString(),
          },
          {
            createdAt: new Date().toISOString(),
            hasAvatar: false,
            id: "profile_tensetutor",
            isSuper: false,
            mcpServerCount: 0,
            model: null,
            name: "Tense Tutor",
            soulActive: false,
            toolCount: 0,
            updatedAt: new Date().toISOString(),
          },
        ],
      });
      const sessionStore = new SessionStore(
        path.join(homeDir, ".nakama", "whatsapp", "chat-sessions.json")
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const { socket, sent } = createMockSocket();

      const handleMessage = createChatHandler({
        authStore,
        client,
        config: { phoneNumber: "1234567890", profileId: "default" },
        getSocket: () => socket as any,
        orgStore,
        sessionStore,
      });

      await handleMessage({ jid: "9999999999@s.whatsapp.net", text: "hello" });

      expect(sent.length).toBeGreaterThanOrEqual(1);
      expect(calls.createSession).toBe(0);
      expect(calls.sendStream).toBe(0);
    });
  });

  test("stays silent when the account is not linked", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        phoneNumber: "1234567890",
      });

      const authStore = new WhatsAppAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient();
      const sessionStore = new SessionStore(
        path.join(homeDir, ".nakama", "whatsapp", "chat-sessions.json")
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const { socket, sent } = createMockSocket();

      const handleMessage = createChatHandler({
        authStore,
        client,
        config: { phoneNumber: "1234567890", profileId: "default" },
        getSocket: () => socket as any,
        orgStore,
        sessionStore,
      });

      await handleMessage({ jid: "9999999999@s.whatsapp.net", text: "hello" });
      await handleMessage({ jid: "9999999999@s.whatsapp.net", text: "/start" });
      await handleMessage({ jid: "9999999999@s.whatsapp.net", text: "/help" });

      expect(sent).toEqual([]);
      expect(calls.createSession).toBe(0);
      expect(calls.sendStream).toBe(0);
    });
  });

  test("rejects invalid pairing codes", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        pairingCode: "ABCD1234",
        phoneNumber: "1234567890",
      });

      const authStore = new WhatsAppAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient({
        profiles: [
          {
            createdAt: new Date().toISOString(),
            hasAvatar: false,
            id: "default",
            isSuper: false,
            mcpServerCount: 0,
            model: null,
            name: "Default",
            soulActive: false,
            toolCount: 0,
            updatedAt: new Date().toISOString(),
          },
          {
            createdAt: new Date().toISOString(),
            hasAvatar: false,
            id: "profile_tensetutor",
            isSuper: false,
            mcpServerCount: 0,
            model: null,
            name: "Tense Tutor",
            soulActive: false,
            toolCount: 0,
            updatedAt: new Date().toISOString(),
          },
        ],
      });
      const sessionStore = new SessionStore(
        path.join(homeDir, ".nakama", "whatsapp", "chat-sessions.json")
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const { socket, sent } = createMockSocket();

      const handleMessage = createChatHandler({
        authStore,
        client,
        config: { phoneNumber: "1234567890", profileId: "default" },
        getSocket: () => socket as any,
        orgStore,
        sessionStore,
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
        pairingCode: "ABCD1234",
        phoneNumber: "1234567890",
      });

      const authStore = new WhatsAppAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient({
        profiles: [
          {
            createdAt: new Date().toISOString(),
            hasAvatar: false,
            id: "default",
            isSuper: false,
            mcpServerCount: 0,
            model: null,
            name: "Default",
            soulActive: false,
            toolCount: 0,
            updatedAt: new Date().toISOString(),
          },
          {
            createdAt: new Date().toISOString(),
            hasAvatar: false,
            id: "profile_tensetutor",
            isSuper: false,
            mcpServerCount: 0,
            model: null,
            name: "Tense Tutor",
            soulActive: false,
            toolCount: 0,
            updatedAt: new Date().toISOString(),
          },
        ],
      });
      const sessionStore = new SessionStore(
        path.join(homeDir, ".nakama", "whatsapp", "chat-sessions.json")
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const { socket, sent } = createMockSocket();

      const handleMessage = createChatHandler({
        authStore,
        client,
        config: { phoneNumber: "1234567890", profileId: "default" },
        getSocket: () => socket as any,
        orgStore,
        sessionStore,
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
        pairedJid: PAIRED_JID,
        phoneNumber: "1234567890",
      });

      const authStore = new WhatsAppAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient({
        profiles: [
          {
            createdAt: new Date().toISOString(),
            hasAvatar: false,
            id: "default",
            isSuper: false,
            mcpServerCount: 0,
            model: null,
            name: "Default",
            soulActive: false,
            toolCount: 0,
            updatedAt: new Date().toISOString(),
          },
          {
            createdAt: new Date().toISOString(),
            hasAvatar: false,
            id: "profile_tensetutor",
            isSuper: false,
            mcpServerCount: 0,
            model: null,
            name: "Tense Tutor",
            soulActive: false,
            toolCount: 0,
            updatedAt: new Date().toISOString(),
          },
        ],
      });
      const sessionStore = new SessionStore(
        path.join(homeDir, ".nakama", "whatsapp", "chat-sessions.json")
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const { socket } = createMockSocket();

      const handleMessage = createChatHandler({
        authStore,
        client,
        config: { phoneNumber: "1234567890", profileId: "default" },
        getSocket: () => socket as any,
        orgStore,
        sessionStore,
      });

      await handleMessage({ jid: PAIRED_JID, text: "hello agent" });

      expect(calls.createSession).toBe(1);
      expect(calls.sendStream).toBe(1);
    });
  });

  test("allows device-suffixed inbound JID for a paired phone JID", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        pairedJid: "6281379292556@s.whatsapp.net",
        phoneNumber: "6281379292556",
      });

      const authStore = new WhatsAppAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient({
        profiles: [
          {
            createdAt: new Date().toISOString(),
            hasAvatar: false,
            id: "default",
            isSuper: false,
            mcpServerCount: 0,
            model: null,
            name: "Default",
            soulActive: false,
            toolCount: 0,
            updatedAt: new Date().toISOString(),
          },
          {
            createdAt: new Date().toISOString(),
            hasAvatar: false,
            id: "profile_tensetutor",
            isSuper: false,
            mcpServerCount: 0,
            model: null,
            name: "Tense Tutor",
            soulActive: false,
            toolCount: 0,
            updatedAt: new Date().toISOString(),
          },
        ],
      });
      const sessionStore = new SessionStore(
        path.join(homeDir, ".nakama", "whatsapp", "chat-sessions.json")
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const { socket } = createMockSocket();

      const handleMessage = createChatHandler({
        authStore,
        client,
        config: { phoneNumber: "6281379292556", profileId: "default" },
        getSocket: () => socket as any,
        orgStore,
        sessionStore,
      });

      await handleMessage({
        jid: "6281379292556:12@s.whatsapp.net",
        text: "hello agent",
      });

      expect(calls.createSession).toBe(1);
      expect(calls.sendStream).toBe(1);
    });
  });

  test("handles /help command for authorized JID", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        pairedJid: PAIRED_JID,
        phoneNumber: "1234567890",
      });

      const authStore = new WhatsAppAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient();
      const sessionStore = new SessionStore(
        path.join(homeDir, ".nakama", "whatsapp", "chat-sessions.json")
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const { socket, sent } = createMockSocket();

      const handleMessage = createChatHandler({
        authStore,
        client,
        config: { phoneNumber: "1234567890", profileId: "default" },
        getSocket: () => socket as any,
        orgStore,
        sessionStore,
      });

      await handleMessage({ jid: PAIRED_JID, text: "/help" });

      const helpText = sent.map((message) => message.text).join("\n");
      expect(helpText).toContain("/help");
      expect(helpText).toContain("/attach");
      expect(calls.sendStream).toBe(0);
    });
  });

  test("handles /clear command", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        pairedJid: PAIRED_JID,
        phoneNumber: "1234567890",
      });

      const authStore = new WhatsAppAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient();
      const sessionStore = new SessionStore(
        path.join(homeDir, ".nakama", "whatsapp", "chat-sessions.json")
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const { socket, sent } = createMockSocket();

      const handleMessage = createChatHandler({
        authStore,
        client,
        config: { phoneNumber: "1234567890", profileId: "default" },
        getSocket: () => socket as any,
        orgStore,
        sessionStore,
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
        pairedJid: PAIRED_JID,
        phoneNumber: "1234567890",
      });

      const authStore = new WhatsAppAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient();
      const sessionStore = new SessionStore(
        path.join(homeDir, ".nakama", "whatsapp", "chat-sessions.json")
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const { socket, sent } = createMockSocket();

      const handleMessage = createChatHandler({
        authStore,
        client,
        config: { phoneNumber: "1234567890", profileId: "default" },
        getSocket: () => socket as any,
        orgStore,
        sessionStore,
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
        pairedJid: PAIRED_JID,
        phoneNumber: "1234567890",
      });

      const authStore = new WhatsAppAuthStore();
      await authStore.reload();
      const { client, calls, getStreamControl } = createMockClient({
        streaming: true,
      });
      const sessionStore = new SessionStore(
        path.join(homeDir, ".nakama", "whatsapp", "chat-sessions.json")
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const { socket, sent } = createMockSocket();

      const handleMessage = createChatHandler({
        authStore,
        client,
        config: { phoneNumber: "1234567890", profileId: "default" },
        getSocket: () => socket as any,
        orgStore,
        sessionStore,
      });

      const chatPromise = handleMessage({
        jid: PAIRED_JID,
        text: "hello agent",
      });

      await waitForStreamControl(getStreamControl);

      await handleMessage({ jid: PAIRED_JID, text: "/stop" });

      await chatPromise;

      expect(calls.sendStream).toBe(1);
      expect(sent.map((message) => message.text)).toEqual(["Stopped."]);
    });
  });

  test("/stop with no active stream replies nothing to stop", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        pairedJid: PAIRED_JID,
        phoneNumber: "1234567890",
      });

      const authStore = new WhatsAppAuthStore();
      await authStore.reload();
      const { client } = createMockClient();
      const sessionStore = new SessionStore(
        path.join(homeDir, ".nakama", "whatsapp", "chat-sessions.json")
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const { socket, sent } = createMockSocket();

      const handleMessage = createChatHandler({
        authStore,
        client,
        config: { phoneNumber: "1234567890", profileId: "default" },
        getSocket: () => socket as any,
        orgStore,
        sessionStore,
      });

      await handleMessage({ jid: PAIRED_JID, text: "/stop" });

      expect(sent.length).toBe(1);
      expect(sent[0].text).toBe("Nothing to stop.");
    });
  });

  test("unknown commands return help text", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        pairedJid: PAIRED_JID,
        phoneNumber: "1234567890",
      });

      const authStore = new WhatsAppAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient();
      const sessionStore = new SessionStore(
        path.join(homeDir, ".nakama", "whatsapp", "chat-sessions.json")
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const { socket, sent } = createMockSocket();

      const handleMessage = createChatHandler({
        authStore,
        client,
        config: { phoneNumber: "1234567890", profileId: "default" },
        getSocket: () => socket as any,
        orgStore,
        sessionStore,
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
        pairedJid: PAIRED_JID,
        phoneNumber: "1234567890",
        profileId: "missing_profile",
      });

      const authStore = new WhatsAppAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient({
        profiles: [
          {
            createdAt: new Date().toISOString(),
            hasAvatar: false,
            id: "profile_tensetutor",
            isSuper: false,
            mcpServerCount: 0,
            model: null,
            name: "Tense Tutor",
            soulActive: false,
            toolCount: 0,
            updatedAt: new Date().toISOString(),
          },
        ],
      });
      const sessionStore = new SessionStore(
        path.join(homeDir, ".nakama", "whatsapp", "chat-sessions.json")
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const { socket, sent } = createMockSocket();

      const handleMessage = createChatHandler({
        authStore,
        client,
        config: { phoneNumber: "1234567890", profileId: "default" },
        getSocket: () => socket as any,
        orgStore,
        sessionStore,
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
        pairedJid: PAIRED_JID,
        phoneNumber: "1234567890",
      });

      const authStore = new WhatsAppAuthStore();
      await authStore.reload();
      const { client, calls, orgIds } = createMockClient();
      const sessionStore = new SessionStore(
        path.join(homeDir, ".nakama", "whatsapp", "chat-sessions.json")
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const { socket } = createMockSocket();
      const handleMessage = createChatHandler({
        authStore,
        client,
        config: { phoneNumber: "1234567890", profileId: "default" },
        getSocket: () => socket as any,
        orgStore,
        sessionStore,
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
        pairedJid: PAIRED_JID,
        phoneNumber: "1234567890",
      });

      const authStore = new WhatsAppAuthStore();
      await authStore.reload();
      const { client } = createMockClient();
      const sessionStore = new SessionStore(
        path.join(homeDir, ".nakama", "whatsapp", "chat-sessions.json")
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const { socket, sent } = createMockSocket();
      const handleMessage = createChatHandler({
        authStore,
        client,
        config: { phoneNumber: "1234567890", profileId: "default" },
        getSocket: () => socket as any,
        orgStore,
        sessionStore,
      });

      await handleMessage({ jid: PAIRED_JID, text: "hello" });

      expect(
        sent.some((message) => message.text.includes("Choose an organization"))
      ).toBe(false);
      expect(orgStore.get(PAIRED_JID)?.orgId).toBe("org_test");
    });
  });

  test("prompts for org selection when multiple orgs exist", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        pairedJid: PAIRED_JID,
        phoneNumber: "1234567890",
      });

      const authStore = new WhatsAppAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient({
        orgs: createMultiTestOrgs(),
      });
      const sessionStore = new SessionStore(
        path.join(homeDir, ".nakama", "whatsapp", "chat-sessions.json")
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const { socket, sent } = createMockSocket();
      const handleMessage = createChatHandler({
        authStore,
        client,
        config: { phoneNumber: "1234567890", profileId: "default" },
        getSocket: () => socket as any,
        orgStore,
        sessionStore,
      });

      await handleMessage({ jid: PAIRED_JID, text: "hello" });

      expect(
        sent.some((message) => message.text.includes("Choose an organization"))
      ).toBe(true);
      expect(calls.createSession).toBe(0);
      expect(calls.sendStream).toBe(0);
    });
  });

  test("continues chatting after the user selects an org", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        pairedJid: PAIRED_JID,
        phoneNumber: "1234567890",
      });

      const authStore = new WhatsAppAuthStore();
      await authStore.reload();
      const { client, calls, orgIds } = createMockClient({
        orgs: createMultiTestOrgs(),
      });
      const sessionStore = new SessionStore(
        path.join(homeDir, ".nakama", "whatsapp", "chat-sessions.json")
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const { socket, sent } = createMockSocket();
      const handleMessage = createChatHandler({
        authStore,
        client,
        config: { phoneNumber: "1234567890", profileId: "default" },
        getSocket: () => socket as any,
        orgStore,
        sessionStore,
      });

      await handleMessage({ jid: PAIRED_JID, text: "2" });
      expect(orgIds).toContain("org_b");
      expect(
        sent.some((message) => message.text.includes("Now using Beta"))
      ).toBe(true);

      await handleMessage({ jid: PAIRED_JID, text: "hello" });
      expect(calls.createSession).toBe(1);
      expect(calls.sendStream).toBe(1);
    });
  });
});

const GROUP_JID = "120363042000000000@g.us";
const BOT_ME = {
  id: "628100000000@s.whatsapp.net",
  lid: "236283431522503@lid",
};

function groupInbound(options: {
  text: string;
  senderJid?: string;
  senderJids?: string[];
  mentionedJids?: string[];
  quotedParticipant?: string | null;
  quotedText?: string | null;
  fromMe?: boolean;
}) {
  const senderJid = options.senderJid ?? PAIRED_JID;
  return {
    fromMe: options.fromMe ?? false,
    isGroup: true,
    jid: GROUP_JID,
    me: BOT_ME,
    mentionedJids: options.mentionedJids ?? [],
    quotedParticipant: options.quotedParticipant ?? null,
    quotedText: options.quotedText ?? null,
    senderJid,
    senderJids: options.senderJids ?? [senderJid],
    text: options.text,
  };
}

describe("createChatHandler group chats", () => {
  test("ignores plain group messages without mention", async () => {
    await withTempHome(async (homeDir) => {
      const privateMessage = "private 🔒 message";
      const senderJid = "6281379292556@s.whatsapp.net";
      const log = spyOn(console, "log").mockImplementation(() => {});

      try {
        await writeWhatsAppConfigIni(homeDir, {
          pairedJid: PAIRED_JID,
          phoneNumber: "1234567890",
        });

        const authStore = new WhatsAppAuthStore();
        await authStore.reload();
        const { client, calls } = createMockClient();
        const sessionStore = new SessionStore(
          path.join(homeDir, ".nakama", "whatsapp", "chat-sessions.json")
        );
        const orgStore = createTestOrgStore(homeDir);
        await orgStore.load();
        const { socket, sent } = createMockSocket();
        const handleMessage = createChatHandler({
          authStore,
          client,
          config: { phoneNumber: "1234567890", profileId: "default" },
          getSocket: () => socket as any,
          orgStore,
          sessionStore,
        });

        await handleMessage(groupInbound({ senderJid, text: privateMessage }));

        const output = log.mock.calls
          .map((args) => args.map(String).join(" "))
          .join("\n");

        expect(sent).toEqual([]);
        expect(calls.createSession).toBe(0);
        expect(calls.sendStream).toBe(0);
        expect(output).toContain("jid=***0000@g.us");
        expect(output).toContain("sender=***2556@s.whatsapp.net");
        expect(output).toContain(
          `textBytes=${Buffer.byteLength(privateMessage, "utf8")}`
        );
        expect(output).not.toContain(privateMessage);
        expect(output).not.toContain(GROUP_JID);
        expect(output).not.toContain(senderJid);
      } finally {
        log.mockRestore();
      }
    });
  });

  test("group @mention triggers agent when sender is paired", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        pairedJid: PAIRED_JID,
        phoneNumber: "1234567890",
      });

      const authStore = new WhatsAppAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient();
      const sessionStore = new SessionStore(
        path.join(homeDir, ".nakama", "whatsapp", "chat-sessions.json")
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const { socket, sent } = createMockSocket();
      const handleMessage = createChatHandler({
        authStore,
        client,
        config: { phoneNumber: "1234567890", profileId: "default" },
        getSocket: () => socket as any,
        orgStore,
        sessionStore,
      });

      await handleMessage(
        groupInbound({
          mentionedJids: [BOT_ME.id],
          text: "@Nakama hello",
        })
      );

      expect(calls.createSession).toBe(1);
      expect(calls.sendStream).toBe(1);
      expect(sessionStore.get(GROUP_JID)?.sessionId).toBe("session_test");
      expect(calls.streamInputs[0]).toEqual({
        message:
          "[WhatsApp group — your reply is visible to everyone in this group.]\nhello",
      });
      expect(sent.at(-1)?.jid).toBe(GROUP_JID);
    });
  });

  test("includes quoted group message text in the agent turn", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        pairedJid: PAIRED_JID,
        phoneNumber: "1234567890",
      });

      const authStore = new WhatsAppAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient();
      const sessionStore = new SessionStore(
        path.join(homeDir, ".nakama", "whatsapp", "chat-sessions.json")
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const { socket } = createMockSocket();
      const handleMessage = createChatHandler({
        authStore,
        client,
        config: { phoneNumber: "1234567890", profileId: "default" },
        getSocket: () => socket as any,
        orgStore,
        sessionStore,
      });

      await handleMessage(
        groupInbound({
          mentionedJids: [BOT_ME.id],
          quotedParticipant: "6281352311912@s.whatsapp.net",
          quotedText: "Update Daily Well PHSS 20-08-2026\nSFT-01 Unload flow",
          text: "@Nakama ini data laporan hari berikutnya",
        })
      );

      expect(calls.sendStream).toBe(1);
      expect(calls.streamInputs[0]).toEqual({
        message:
          "[WhatsApp group — your reply is visible to everyone in this group.]\n[Quoted message]\nUpdate Daily Well PHSS 20-08-2026\nSFT-01 Unload flow\n\nini data laporan hari berikutnya",
      });
    });
  });

  test("unpaired @mention redirects to private chat without pairing", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        pairingCode: "ABCD1234",
        phoneNumber: "1234567890",
      });

      const authStore = new WhatsAppAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient();
      const sessionStore = new SessionStore(
        path.join(homeDir, ".nakama", "whatsapp", "chat-sessions.json")
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const { socket, sent } = createMockSocket();
      const handleMessage = createChatHandler({
        authStore,
        client,
        config: { phoneNumber: "1234567890", profileId: "default" },
        getSocket: () => socket as any,
        orgStore,
        sessionStore,
      });

      await handleMessage(
        groupInbound({
          mentionedJids: [BOT_ME.id],
          senderJid: "9999999999@s.whatsapp.net",
          text: "@Nakama hello",
        })
      );

      expect(sent.map((message) => message.text)).toEqual([
        "This WhatsApp number is not linked yet. Open a private chat with this account and send your pairing code from Integrations → WhatsApp.",
      ]);
      expect(calls.sendStream).toBe(0);
      expect(authStore.isAuthorized("9999999999@s.whatsapp.net")).toBe(false);
    });
  });

  test("pairs an unpaired group sender when they send a pairing code", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        pairingCode: "ABCD1234",
        phoneNumber: "1234567890",
      });

      const authStore = new WhatsAppAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient();
      const sessionStore = new SessionStore(
        path.join(homeDir, ".nakama", "whatsapp", "chat-sessions.json")
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const { socket, sent } = createMockSocket();
      const handleMessage = createChatHandler({
        authStore,
        client,
        config: { phoneNumber: "1234567890", profileId: "default" },
        getSocket: () => socket as any,
        orgStore,
        sessionStore,
      });

      await handleMessage(
        groupInbound({
          mentionedJids: [BOT_ME.id],
          senderJid: "9999999999@s.whatsapp.net",
          text: "@Nakama ABCD1234",
        })
      );

      expect(sent[0]?.text).toContain("Linked successfully");
      expect(authStore.isAuthorized("9999999999@s.whatsapp.net")).toBe(true);
      expect(calls.sendStream).toBe(0);
    });
  });

  test("/org in group stores selection under group org key", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        pairedJid: PAIRED_JID,
        phoneNumber: "1234567890",
      });

      const authStore = new WhatsAppAuthStore();
      await authStore.reload();
      const { client } = createMockClient({ orgs: createMultiTestOrgs() });
      const sessionStore = new SessionStore(
        path.join(homeDir, ".nakama", "whatsapp", "chat-sessions.json")
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const { socket } = createMockSocket();
      const handleMessage = createChatHandler({
        authStore,
        client,
        config: { phoneNumber: "1234567890", profileId: "default" },
        getSocket: () => socket as any,
        orgStore,
        sessionStore,
      });

      await handleMessage(groupInbound({ text: "/org 1" }));

      expect(orgStore.get(`g:${GROUP_JID}`)?.orgId).toBe("org_a");
      expect(orgStore.get(PAIRED_JID)).toBeUndefined();
    });
  });

  test("group and private chats keep separate sessions", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        pairedJid: PAIRED_JID,
        phoneNumber: "1234567890",
      });

      const authStore = new WhatsAppAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient();
      const sessionStore = new SessionStore(
        path.join(homeDir, ".nakama", "whatsapp", "chat-sessions.json")
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const { socket } = createMockSocket();
      const handleMessage = createChatHandler({
        authStore,
        client,
        config: { phoneNumber: "1234567890", profileId: "default" },
        getSocket: () => socket as any,
        orgStore,
        sessionStore,
      });

      await handleMessage({ jid: PAIRED_JID, text: "hello privately" });
      await handleMessage(
        groupInbound({
          mentionedJids: [BOT_ME.lid ?? BOT_ME.id],
          text: "@Nakama hello group",
        })
      );

      expect(calls.createSession).toBe(2);
      expect(sessionStore.get(PAIRED_JID)?.sessionId).toBe("session_test");
      expect(sessionStore.get(GROUP_JID)?.sessionId).toBe("session_test");
    });
  });

  test("authorizes a group sender when any of their JIDs matches the paired number", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        pairedJid: PAIRED_JID,
        phoneNumber: "1234567890",
      });

      const authStore = new WhatsAppAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient();
      const sessionStore = new SessionStore(
        path.join(homeDir, ".nakama", "whatsapp", "chat-sessions.json")
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const { socket } = createMockSocket();
      const handleMessage = createChatHandler({
        authStore,
        client,
        config: { phoneNumber: "1234567890", profileId: "default" },
        getSocket: () => socket as any,
        orgStore,
        sessionStore,
      });

      await handleMessage(
        groupInbound({
          mentionedJids: [BOT_ME.id],
          senderJid: "104784384290844@lid",
          senderJids: ["104784384290844@lid", PAIRED_JID],
          text: "@Nakama hello",
        })
      );

      expect(calls.sendStream).toBe(1);
      expect(authStore.getConfig()?.pairedLid).toBe("104784384290844@lid");
    });
  });

  test("authorizes the linked WhatsApp account in a group even when pairing stored a different JID", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        pairedJid: PAIRED_JID,
        phoneNumber: "1234567890",
      });

      const authStore = new WhatsAppAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient();
      const sessionStore = new SessionStore(
        path.join(homeDir, ".nakama", "whatsapp", "chat-sessions.json")
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const { socket } = createMockSocket();
      const handleMessage = createChatHandler({
        authStore,
        client,
        config: { phoneNumber: "1234567890", profileId: "default" },
        getSocket: () => socket as any,
        orgStore,
        sessionStore,
      });

      await handleMessage(
        groupInbound({
          mentionedJids: [BOT_ME.id],
          senderJid: BOT_ME.lid,
          senderJids: [BOT_ME.lid ?? BOT_ME.id],
          text: "@Nakama hello",
        })
      );

      expect(calls.sendStream).toBe(1);
    });
  });

  test("tells an already-linked private chat that a pairing code is unnecessary", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        pairedJid: PAIRED_JID,
        phoneNumber: "1234567890",
      });

      const authStore = new WhatsAppAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient();
      const sessionStore = new SessionStore(
        path.join(homeDir, ".nakama", "whatsapp", "chat-sessions.json")
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const { socket, sent } = createMockSocket();
      const handleMessage = createChatHandler({
        authStore,
        client,
        config: { phoneNumber: "1234567890", profileId: "default" },
        getSocket: () => socket as any,
        orgStore,
        sessionStore,
      });

      await handleMessage({ jid: PAIRED_JID, text: "7A2F629D" });

      expect(sent.map((message) => message.text)).toEqual([
        "This number is already linked.",
      ]);
      expect(calls.sendStream).toBe(0);
    });
  });

  test("allows an allowlisted phone to talk in a group", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        allowedPhones: ["628111111111"],
        pairedJid: PAIRED_JID,
        phoneNumber: "1234567890",
      });

      const authStore = new WhatsAppAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient();
      const sessionStore = new SessionStore(
        path.join(homeDir, ".nakama", "whatsapp", "chat-sessions.json")
      );
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const { socket } = createMockSocket();
      const handleMessage = createChatHandler({
        authStore,
        client,
        config: { phoneNumber: "1234567890", profileId: "default" },
        getSocket: () => socket as any,
        orgStore,
        sessionStore,
      });

      await handleMessage(
        groupInbound({
          mentionedJids: [BOT_ME.id],
          senderJid: "628111111111@s.whatsapp.net",
          text: "@Nakama hello",
        })
      );

      expect(calls.sendStream).toBe(1);
    });
  });
});

describe("createChatHandler artifact delivery", () => {
  const SAMPLE_ARTIFACT = {
    filename: "report.md",
    mimeType: "text/markdown",
    path: "report.md",
    savedAt: "2026-07-13T10:00:00.000Z",
    sharePath: "/s/tok_test",
    shareUrl: "https://app.example/s/tok_test",
    sizeBytes: 42,
  } as const;

  const metaJson = JSON.stringify({
    mimeType: "text/markdown",
    savedAt: "2026-07-13T10:00:00.000Z",
    sizeBytes: 42,
  });

  const artifactMessages = [
    { content: "save report", role: "user" as const },
    {
      content: "",
      role: "assistant" as const,
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
      role: "tool" as const,
      toolCallId: "tool_1",
    },
    {
      content: JSON.stringify({
        bytesWritten: metaJson.length,
        path: "/home/.nakama/orgs/org/profiles/default/artifacts/report.md.nakama-meta.json",
      }),
      name: "write_file",
      role: "tool" as const,
      toolCallId: "tool_2",
    },
    { content: "Saved the report.", role: "assistant" as const },
  ];

  async function withArtifactChat(
    options:
      | {
          deliverableArtifacts?: Array<
            typeof SAMPLE_ARTIFACT | Record<string, unknown>
          >;
          messages?: Parameters<typeof createMockClient>[0]["messages"];
        }
      | undefined,
    run: (ctx: {
      calls: ReturnType<typeof createMockClient>["calls"];
      handleMessage: ReturnType<typeof createChatHandler>;
      sent: ReturnType<typeof createMockSocket>["sent"];
      sessionStore: SessionStore;
    }) => Promise<void>
  ) {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        pairedJid: PAIRED_JID,
        phoneNumber: "1234567890",
      });

      const authStore = new WhatsAppAuthStore();
      await authStore.reload();
      const { calls, client } = createMockClient({
        messages: options?.messages,
      });
      const sessionStore = new SessionStore(
        path.join(homeDir, ".nakama", "whatsapp", "chat-sessions.json")
      );
      await sessionStore.load();
      sessionStore.set(PAIRED_JID, {
        ...(options?.deliverableArtifacts
          ? { deliverableArtifacts: options.deliverableArtifacts }
          : {}),
        profileId: "default",
        sessionId: "session_test",
        updatedAt: new Date().toISOString(),
      });
      await sessionStore.save();
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const { sent, socket } = createMockSocket();
      const handleMessage = createChatHandler({
        authStore,
        client,
        config: { phoneNumber: "1234567890", profileId: "default" },
        getSocket: () => socket as never,
        orgStore,
        sessionStore,
      });

      await run({ calls, handleMessage, sent, sessionStore });
    });
  }

  test("posts a publish share link after a paired save-artifact turn", async () => {
    await withArtifactChat({ messages: artifactMessages }, async (ctx) => {
      await ctx.handleMessage({ jid: PAIRED_JID, text: "thanks" });

      expect(ctx.calls.publishProfileArtifactShare).toBe(1);
      expect(
        ctx.sent.some((message) =>
          message.text.includes("https://app.example/s/tok_test")
        )
      ).toBe(true);
    });
  });

  test("does not publish when the turn has no sidecar pair", async () => {
    await withArtifactChat(
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
      },
      async (ctx) => {
        await ctx.handleMessage({ jid: PAIRED_JID, text: "thanks" });

        expect(ctx.calls.publishProfileArtifactShare).toBe(0);
        expect(ctx.sent.some((message) => message.text.includes("/s/"))).toBe(
          false
        );
      }
    );
  });

  test("sends a document when the user asks to attach a saved artifact", async () => {
    await withArtifactChat(
      { deliverableArtifacts: [SAMPLE_ARTIFACT] },
      async (ctx) => {
        await ctx.handleMessage({ jid: PAIRED_JID, text: "send me the file" });

        expect(ctx.calls.readProfileArtifactContent).toBe(1);
        expect(documentSendCount(ctx.sent)).toBe(1);
        expect(ctx.calls.sendStream).toBe(0);
      }
    );
  });

  test("skips the agent after NL attach so it cannot invent a refusal", async () => {
    await withArtifactChat(
      { deliverableArtifacts: [SAMPLE_ARTIFACT] },
      async (ctx) => {
        await ctx.handleMessage({ jid: PAIRED_JID, text: "attach the csv" });

        expect(documentSendCount(ctx.sent)).toBe(1);
        expect(ctx.calls.sendStream).toBe(0);
        expect(
          ctx.sent.some((message) =>
            message.text.toLowerCase().includes("cannot attach")
          )
        ).toBe(false);
      }
    );
  });

  test("attaches after a same-turn paired save when the user asked to send the file", async () => {
    await withArtifactChat({ messages: artifactMessages }, async (ctx) => {
      await ctx.handleMessage({
        jid: PAIRED_JID,
        text: "save it and send me the file",
      });

      expect(ctx.calls.publishProfileArtifactShare).toBe(1);
      expect(ctx.calls.readProfileArtifactContent).toBe(1);
      expect(documentSendCount(ctx.sent)).toBe(1);
      expect(ctx.calls.sendStream).toBe(1);
    });
  });

  test("attaches in a group when the user asks to send the file", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        pairedJid: PAIRED_JID,
        phoneNumber: "1234567890",
      });

      const authStore = new WhatsAppAuthStore();
      await authStore.reload();
      const { client, calls } = createMockClient();
      const sessionStore = new SessionStore(
        path.join(homeDir, ".nakama", "whatsapp", "chat-sessions.json")
      );
      await sessionStore.load();
      sessionStore.set(GROUP_JID, {
        deliverableArtifacts: [SAMPLE_ARTIFACT],
        profileId: "default",
        sessionId: "session_test",
        updatedAt: new Date().toISOString(),
      });
      await sessionStore.save();
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const { sent, socket } = createMockSocket();
      const handleMessage = createChatHandler({
        authStore,
        client,
        config: { phoneNumber: "1234567890", profileId: "default" },
        getSocket: () => socket as never,
        orgStore,
        sessionStore,
      });

      await handleMessage(
        groupInbound({
          mentionedJids: [BOT_ME.id],
          text: "@Nakama send me the file",
        })
      );

      expect(calls.readProfileArtifactContent).toBe(1);
      expect(documentSendCount(sent)).toBe(1);
      expect(calls.sendStream).toBe(0);
      expect(sent.some((message) => message.jid === GROUP_JID)).toBe(true);
    });
  });

  test("sends a document for /attach without an agent turn", async () => {
    await withArtifactChat(
      { deliverableArtifacts: [SAMPLE_ARTIFACT] },
      async (ctx) => {
        await ctx.handleMessage({ jid: PAIRED_JID, text: "/attach" });

        expect(ctx.calls.readProfileArtifactContent).toBe(1);
        expect(documentSendCount(ctx.sent)).toBe(1);
        expect(ctx.calls.sendStream).toBe(0);
      }
    );
  });

  test("reports when /attach has no artifact available", async () => {
    await withArtifactChat(undefined, async (ctx) => {
      await ctx.handleMessage({ jid: PAIRED_JID, text: "/attach" });

      expect(ctx.calls.readProfileArtifactContent).toBe(0);
      expect(documentSendCount(ctx.sent)).toBe(0);
      expect(
        ctx.sent.some((message) => message.text.includes("No saved artifact"))
      ).toBe(true);
      expect(ctx.calls.sendStream).toBe(0);
    });
  });

  test("rejects oversize attach before reading content", async () => {
    await withArtifactChat(
      {
        deliverableArtifacts: [
          {
            ...SAMPLE_ARTIFACT,
            filename: "huge.bin",
            mimeType: "application/octet-stream",
            path: "huge.bin",
            sizeBytes: 17 * 1024 * 1024,
          },
        ],
      },
      async (ctx) => {
        await ctx.handleMessage({ jid: PAIRED_JID, text: "/attach" });

        expect(ctx.calls.readProfileArtifactContent).toBe(0);
        expect(documentSendCount(ctx.sent)).toBe(0);
        expect(
          ctx.sent.some((message) => message.text.includes("too large"))
        ).toBe(true);
        expect(ctx.calls.sendStream).toBe(0);
      }
    );
  });

  test("clears deliverable artifacts on /clear", async () => {
    await withArtifactChat(
      { deliverableArtifacts: [SAMPLE_ARTIFACT] },
      async (ctx) => {
        await ctx.handleMessage({ jid: PAIRED_JID, text: "/clear" });

        expect(ctx.sessionStore.getDeliverableArtifacts(PAIRED_JID)).toEqual(
          []
        );
      }
    );
  });
});
