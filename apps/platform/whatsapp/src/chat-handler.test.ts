import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import path from "node:path";
import { Readable } from "node:stream";
import {
  hasActiveStreams,
  resetActiveStreamsForTests,
  stopActiveStream,
} from "@nakama/core/channel-active-stream";
import { ChannelSessionStore as SessionStore } from "@nakama/core/channel-session-store";
import {
  getWhatsAppConfigDir,
  saveWhatsAppConfig,
  syncWhatsAppOwnerPairing,
} from "@nakama/core/whatsapp-config";
import * as baileys from "@whiskeysockets/baileys";
import { WhatsAppAuthStore } from "./auth-store";
import {
  createChatHandler,
  resetChatLocksForTests,
  withChatLock,
} from "./chat-handler";
import { resetWhatsAppOutboundForTests } from "./inbound-message";
import {
  createMockClient,
  createMultiTestOrgs,
  createTestOrgStore,
  waitForStreamControl,
  withTempHome,
  writeWhatsAppConfigIni,
} from "./test-helpers";

const PAIRED_JID = "1234567890@s.whatsapp.net";

function defaultProfiles() {
  return [
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
  ];
}

const PAIRING_CODE = "A1B2C3D4E5F60718293A4B5C6D7E8F90";
const LIVE_CODE_EXPIRY = new Date(Date.now() + 10 * 60 * 1000).toISOString();
const WRONG_PAIRING_CODE = "0".repeat(32);

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

async function createTestHandler(
  homeDir: string,
  options: Omit<
    Parameters<typeof createChatHandler>[0],
    "authStore" | "client" | "sessionStore" | "orgStore" | "getSocket"
  > = { config: { phoneNumber: "1234567890", profileId: "default" } },
  clientOptions: Parameters<typeof createMockClient>[0] = {}
) {
  const authStore = new WhatsAppAuthStore();
  await authStore.reload();
  const mock = createMockClient(clientOptions);
  const sessionStore = new SessionStore(
    path.join(homeDir, ".nakama", "whatsapp", "chat-sessions.json")
  );
  const orgStore = createTestOrgStore(homeDir);
  await orgStore.load();
  const { socket, sent } = createMockSocket();
  const handler = createChatHandler({
    ...options,
    authStore,
    client: mock.client,
    getSocket: () => socket as any,
    orgStore,
    sessionStore,
  });
  return { ...mock, authStore, handler, orgStore, sent, sessionStore, socket };
}

function documentSendCount(
  sent: Array<{ content: Record<string, unknown> }>
): number {
  return sent.filter((entry) => entry.content.document !== undefined).length;
}

beforeEach(() => {
  resetActiveStreamsForTests();
  resetChatLocksForTests();
  resetWhatsAppOutboundForTests();
});

describe("createChatHandler", () => {
  test("passes photos, image documents, and PDFs to the agent and reports media errors", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        pairedJid: PAIRED_JID,
        phoneNumber: "1234567890",
      });
      const {
        calls,
        handler: handle,
        sent,
      } = await createTestHandler(homeDir, {
        config: { phoneNumber: "1234567890", profileId: "default" },
        whatsappContextToken: "worker-secret",
      });
      const download = spyOn(
        baileys,
        "downloadContentFromMessage"
      ).mockImplementation(
        async () => Readable.from([Buffer.from("file bytes")]) as any
      );

      try {
        await handle({
          jid: PAIRED_JID,
          media: { kind: "image", message: { mimetype: "image/jpeg" } },
          text: "",
        });
        await handle({
          jid: PAIRED_JID,
          media: { kind: "image", message: { mimetype: "image/jpeg" } },
          text: "check this",
        });
        await handle({
          jid: PAIRED_JID,
          media: {
            kind: "document",
            message: {
              fileName: "receipt.png",
              mimetype: "application/octet-stream",
            },
          },
          text: "",
        });
        await handle({
          jid: PAIRED_JID,
          media: {
            kind: "document",
            message: { fileName: "receipt.pdf", mimetype: "application/pdf" },
          },
          text: "import this",
        });

        expect(calls.streamInputs).toEqual([
          {
            images: [
              {
                data: Buffer.from("file bytes").toString("base64"),
                mediaType: "image/jpeg",
              },
            ],
            message: "",
          },
          {
            images: [
              {
                data: Buffer.from("file bytes").toString("base64"),
                mediaType: "image/jpeg",
              },
            ],
            message: "check this",
          },
          {
            images: [
              {
                data: Buffer.from("file bytes").toString("base64"),
                mediaType: "image/png",
              },
            ],
            message: "",
          },
          {
            documents: [
              {
                data: Buffer.from("file bytes").toString("base64"),
                filename: "receipt.pdf",
                mediaType: "application/pdf",
              },
            ],
            message: "import this",
          },
        ]);
        expect(calls.streamOptions[0]).toMatchObject({
          whatsappContextToken: "worker-secret",
          whatsappMessage: {
            chatJid: PAIRED_JID,
            fromMe: false,
            isGroup: false,
            senderJid: PAIRED_JID,
            senderJids: [PAIRED_JID],
          },
        });

        await handle({
          jid: PAIRED_JID,
          media: {
            kind: "document",
            message: { fileName: "bad.zip", mimetype: "application/zip" },
          },
          text: "",
        });
        await handle({
          jid: PAIRED_JID,
          media: { kind: "image", message: { fileLength: 6 * 1024 * 1024 } },
          text: "",
        });
        expect(sent.at(-2)?.text).toContain("Unsupported file type");
        expect(sent.at(-1)?.text).toContain("too large");

        download.mockImplementation(
          async () => Readable.from([Buffer.alloc(6 * 1024 * 1024)]) as any
        );
        await handle({
          jid: PAIRED_JID,
          media: { kind: "image", message: { mimetype: "image/jpeg" } },
          text: "",
        });
        expect(sent.at(-1)?.text).toContain("too large");

        download.mockImplementation(async () => {
          throw new Error("network");
        });
        await handle({
          jid: PAIRED_JID,
          media: { kind: "image", message: { mimetype: "image/jpeg" } },
          text: "",
        });
        expect(sent.at(-1)?.text).toContain("Could not download");
        expect(calls.sendStream).toBe(4);
      } finally {
        download.mockRestore();
      }
    });
  });

  test("pins an organization's number even when a sender requests another org", async () => {
    await withTempHome(async (homeDir) => {
      await saveWhatsAppConfig({}, "org_a");
      await syncWhatsAppOwnerPairing({ ownerJid: PAIRED_JID }, "org_a");
      const authStore = new WhatsAppAuthStore("org_a");
      await authStore.reload();
      const { client, calls, orgIds } = createMockClient({
        orgs: createMultiTestOrgs(),
      });
      const sessionStore = new SessionStore(
        path.join(getWhatsAppConfigDir("org_a"), "chat-sessions.json")
      );
      const orgStore = createTestOrgStore(homeDir);
      const { socket } = createMockSocket();
      const handle = createChatHandler({
        authStore,
        client,
        config: { orgId: "org_a", phoneNumber: "", profileId: "default" },
        getSocket: () => socket as any,
        orgStore,
        sessionStore,
      });
      await handle({ jid: PAIRED_JID, text: "/org org_b" });
      await handle({ jid: PAIRED_JID, text: "well test" });
      expect(calls.listUserOrgs).toBe(0);
      expect(calls.sendStream).toBe(1);
      expect(orgIds.length).toBeGreaterThan(0);
      expect(orgIds.every((id) => id === "org_a")).toBe(true);
    });
  });

  test("blocks unauthorized JID from chatting", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        pairingCode: PAIRING_CODE,
        pairingCodeExpiresAt: LIVE_CODE_EXPIRY,
        phoneNumber: "1234567890",
      });

      const {
        calls,
        handler: handleMessage,
        sent,
      } = await createTestHandler(homeDir, undefined, {
        profiles: defaultProfiles(),
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

      const {
        calls,
        handler: handleMessage,
        sent,
      } = await createTestHandler(homeDir);

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
        pairingCode: PAIRING_CODE,
        pairingCodeExpiresAt: LIVE_CODE_EXPIRY,
        phoneNumber: "1234567890",
      });

      const {
        calls,
        handler: handleMessage,
        sent,
      } = await createTestHandler(homeDir, undefined, {
        profiles: defaultProfiles(),
      });

      await handleMessage({
        jid: "9999999999@s.whatsapp.net",
        text: WRONG_PAIRING_CODE,
      });

      expect(sent.length).toBe(1);
      expect(sent[0].text).toContain("That pairing code did not work");
      expect(calls.sendStream).toBe(0);
    });
  });

  test("pairs a JID with a valid code and allows chatting", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        pairingCode: PAIRING_CODE,
        pairingCodeExpiresAt: LIVE_CODE_EXPIRY,
        phoneNumber: "1234567890",
      });

      const {
        calls,
        authStore,
        handler: handleMessage,
        sent,
      } = await createTestHandler(homeDir, undefined, {
        profiles: defaultProfiles(),
      });

      const pairJid = "1234567890@s.whatsapp.net";
      await handleMessage({ jid: pairJid, text: PAIRING_CODE });

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

      const { calls, handler: handleMessage } = await createTestHandler(
        homeDir,
        undefined,
        {
          profiles: defaultProfiles(),
        }
      );

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

      const { calls, handler: handleMessage } = await createTestHandler(
        homeDir,
        {
          config: { phoneNumber: "6281379292556", profileId: "default" },
        },
        {
          profiles: defaultProfiles(),
        }
      );

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

      const {
        calls,
        handler: handleMessage,
        sent,
      } = await createTestHandler(homeDir);

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

      const {
        calls,
        handler: handleMessage,
        sent,
      } = await createTestHandler(homeDir);

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

      const {
        calls,
        handler: handleMessage,
        sent,
      } = await createTestHandler(homeDir);

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

      const {
        calls,
        getStreamControl,
        handler: handleMessage,
        sent,
      } = await createTestHandler(homeDir, undefined, {
        streaming: true,
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

      const { handler: handleMessage, sent } = await createTestHandler(homeDir);

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

      const {
        calls,
        handler: handleMessage,
        sent,
      } = await createTestHandler(homeDir);

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

      const {
        calls,
        handler: handleMessage,
        sent,
      } = await createTestHandler(homeDir, undefined, {
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

      const {
        calls,
        orgIds,
        handler: handleMessage,
      } = await createTestHandler(homeDir);

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

      const {
        orgStore,
        handler: handleMessage,
        sent,
      } = await createTestHandler(homeDir);

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

      const {
        calls,
        handler: handleMessage,
        sent,
      } = await createTestHandler(homeDir, undefined, {
        orgs: createMultiTestOrgs(),
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

      const {
        calls,
        orgIds,
        handler: handleMessage,
        sent,
      } = await createTestHandler(homeDir, undefined, {
        orgs: createMultiTestOrgs(),
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
      const previousDebug = process.env.NAKAMA_CH_DEBUG;
      process.env.NAKAMA_CH_DEBUG = "1";
      const log = spyOn(console, "log").mockImplementation(() => {});

      try {
        await writeWhatsAppConfigIni(homeDir, {
          pairedJid: PAIRED_JID,
          phoneNumber: "1234567890",
        });

        const {
          calls,
          handler: handleMessage,
          sent,
        } = await createTestHandler(homeDir);

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
        if (previousDebug === undefined) {
          delete process.env.NAKAMA_CH_DEBUG;
        } else {
          process.env.NAKAMA_CH_DEBUG = previousDebug;
        }
      }
    });
  });

  test("plain group message reaches the agent when mention is not required", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        pairedJid: PAIRED_JID,
        phoneNumber: "1234567890",
        requireGroupMention: false,
      });

      const {
        calls,
        handler: handleMessage,
        sent,
      } = await createTestHandler(homeDir);

      await handleMessage(groupInbound({ text: "hello without mention" }));

      expect(calls.createSession).toBe(1);
      expect(calls.sendStream).toBe(1);
      expect(calls.streamInputs[0]).toEqual({
        message:
          "[WhatsApp group — your reply is visible to everyone in this group.]\nhello without mention",
      });
      expect(sent.at(-1)?.jid).toBe(GROUP_JID);
    });
  });

  test("does not treat the bot's own group reply as a new turn", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        pairedJid: PAIRED_JID,
        phoneNumber: "1234567890",
        requireGroupMention: false,
      });

      const {
        calls,
        handler: handleMessage,
        sent,
      } = await createTestHandler(homeDir);

      await handleMessage(groupInbound({ text: "hi" }));
      const botReply = sent.at(-1)?.text ?? "";
      expect(botReply).toBeTruthy();
      expect(calls.sendStream).toBe(1);

      await handleMessage(
        groupInbound({
          fromMe: true,
          text: botReply,
        })
      );

      expect(calls.sendStream).toBe(1);
      expect(calls.createSession).toBe(1);
    });
  });

  test("unpaired plain group message reaches the agent when mention is not required", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        pairingCode: PAIRING_CODE,
        pairingCodeExpiresAt: LIVE_CODE_EXPIRY,
        phoneNumber: "1234567890",
        requireGroupMention: false,
      });

      const { calls, handler: handleMessage } =
        await createTestHandler(homeDir);

      await handleMessage(
        groupInbound({
          senderJid: "9999999999@s.whatsapp.net",
          text: "hello without mention",
        })
      );

      expect(calls.sendStream).toBe(1);
    });
  });

  test("group @mention triggers agent when sender is paired", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        pairedJid: PAIRED_JID,
        phoneNumber: "1234567890",
      });

      const {
        calls,
        sessionStore,
        handler: handleMessage,
        sent,
      } = await createTestHandler(homeDir);

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

      const { calls, handler: handleMessage } =
        await createTestHandler(homeDir);

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
        pairingCode: PAIRING_CODE,
        pairingCodeExpiresAt: LIVE_CODE_EXPIRY,
        phoneNumber: "1234567890",
      });

      const {
        calls,
        authStore,
        handler: handleMessage,
        sent,
      } = await createTestHandler(homeDir);

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

  test("unauthorized /stop in a group does not abort the active stream", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        pairedJid: PAIRED_JID,
        phoneNumber: "1234567890",
        requireGroupMention: false,
      });

      const {
        calls,
        getStreamControl,
        authStore,
        handler: handleMessage,
        sent,
      } = await createTestHandler(homeDir, undefined, {
        streaming: true,
      });

      const chatPromise = handleMessage(
        groupInbound({
          text: "hello agent",
        })
      );

      await waitForStreamControl(getStreamControl);

      const sentBeforeStop = sent.length;
      await handleMessage(
        groupInbound({
          senderJid: "9999999999@s.whatsapp.net",
          text: "/stop",
        })
      );

      expect(getStreamControl()?.signal?.aborted).toBe(false);
      expect(sent.length).toBe(sentBeforeStop);
      expect(authStore.isAuthorized("9999999999@s.whatsapp.net")).toBe(false);

      getStreamControl()?.complete();
      await chatPromise.catch(() => undefined);

      expect(calls.sendStream).toBe(1);
    });
  });

  test("pairs an unpaired group sender when they send a pairing code", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        pairingCode: PAIRING_CODE,
        pairingCodeExpiresAt: LIVE_CODE_EXPIRY,
        phoneNumber: "1234567890",
      });

      const {
        calls,
        authStore,
        handler: handleMessage,
        sent,
      } = await createTestHandler(homeDir);

      await handleMessage(
        groupInbound({
          mentionedJids: [BOT_ME.id],
          senderJid: "9999999999@s.whatsapp.net",
          text: `@Nakama ${PAIRING_CODE}`,
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

      const { orgStore, handler: handleMessage } = await createTestHandler(
        homeDir,
        undefined,
        { orgs: createMultiTestOrgs() }
      );

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

      const {
        calls,
        sessionStore,
        handler: handleMessage,
      } = await createTestHandler(homeDir);

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

      const {
        calls,
        authStore,
        handler: handleMessage,
      } = await createTestHandler(homeDir);

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

      const { calls, handler: handleMessage } =
        await createTestHandler(homeDir);

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

      const {
        calls,
        handler: handleMessage,
        sent,
      } = await createTestHandler(homeDir);

      await handleMessage({ jid: PAIRED_JID, text: PAIRING_CODE });

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

      const { calls, handler: handleMessage } =
        await createTestHandler(homeDir);

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

  test("answers any group member when mention is not required", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        pairedJid: PAIRED_JID,
        phoneNumber: "1234567890",
        requireGroupMention: false,
      });

      const { calls, handler: handleMessage } =
        await createTestHandler(homeDir);

      await handleMessage(
        groupInbound({
          senderJid: "6281227900622@s.whatsapp.net",
          text: "hi",
        })
      );

      expect(calls.sendStream).toBe(1);
    });
  });

  test("group access off ignores an unpaired member and still answers a paired one", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        allowUnpairedGroupMembers: false,
        pairedJid: PAIRED_JID,
        phoneNumber: "1234567890",
        requireGroupMention: false,
      });

      const {
        calls,
        handler: handleMessage,
        sent,
      } = await createTestHandler(homeDir);

      await handleMessage(
        groupInbound({
          senderJid: "6281227900622@s.whatsapp.net",
          text: "hi",
        })
      );

      expect(sent).toEqual([]);
      expect(calls.sendStream).toBe(0);

      await handleMessage(groupInbound({ text: "hi" }));

      expect(calls.sendStream).toBe(1);
    });
  });

  test("group access on answers an unpaired member only when mentioned", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        allowUnpairedGroupMembers: true,
        pairedJid: PAIRED_JID,
        phoneNumber: "1234567890",
      });

      const { calls, handler: handleMessage } =
        await createTestHandler(homeDir);
      const senderJid = "6281227900622@s.whatsapp.net";

      await handleMessage(groupInbound({ senderJid, text: "hi" }));

      expect(calls.sendStream).toBe(0);

      await handleMessage(
        groupInbound({
          mentionedJids: [BOT_ME.id],
          senderJid,
          text: "@Nakama hi",
        })
      );

      expect(calls.sendStream).toBe(1);
    });
  });

  test("resolves a group LID to an allowlisted phone via group metadata", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        allowedPhones: ["6281352311912"],
        pairedJid: PAIRED_JID,
        phoneNumber: "1234567890",
        requireGroupMention: false,
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
      socket.groupMetadata = async () => ({
        participants: [
          {
            id: "104784384290844@lid",
            jid: "6281352311912@s.whatsapp.net",
          },
        ],
      });
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
          senderJid: "104784384290844@lid",
          text: "hi from lid only",
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
          deliverableArtifacts?: ReturnType<
            SessionStore["getDeliverableArtifacts"]
          >;
          messages?: NonNullable<
            Parameters<typeof createMockClient>[0]
          >["messages"];
          toolEvents?: NonNullable<
            Parameters<typeof createMockClient>[0]
          >["toolEvents"];
          done?: boolean;
          reply?: string;
          streamError?: Error;
          getMessagesError?: Error;
        }
      | undefined,
    run: (ctx: {
      client: ReturnType<typeof createMockClient>["client"];
      calls: ReturnType<typeof createMockClient>["calls"];
      socket: ReturnType<typeof createMockSocket>["socket"];
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
        done: options?.done,
        getMessagesError: options?.getMessagesError,
        messages: options?.messages,
        reply: options?.reply,
        streamError: options?.streamError,
        toolEvents: options?.toolEvents,
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

      await run({ calls, client, handleMessage, sent, sessionStore, socket });
    });
  }

  const selected = (
    path = "report.md",
    sha256 = createHash("sha256").update("# Report").digest("hex")
  ) => ({
    result: {
      ...SAMPLE_ARTIFACT,
      filename: path,
      ok: true,
      path,
      sha256,
      sizeBytes: 8,
      status: "prepared",
    },
    tool: "send_whatsapp_artifact",
    toolCallId: "send_1",
  });
  const writeEvents = artifactMessages
    .filter((message) => message.role === "tool")
    .map((message) => ({
      result: JSON.parse(message.content),
      tool: message.name,
      toolCallId: message.toolCallId,
    }));

  test.each([
    "send file monthly report.csv",
    "send that again",
    "kirim laporan bulanan",
    "send September 1 to 27 in one CSV",
    "send report.csv",
  ])(
    "routes natural requests through the agent unchanged: %s",
    async (text) => {
      await withArtifactChat(
        { deliverableArtifacts: [SAMPLE_ARTIFACT] },
        async (ctx) => {
          await ctx.handleMessage({ jid: PAIRED_JID, text });
          expect(ctx.calls.streamInputs).toEqual([{ message: text }]);
          expect(documentSendCount(ctx.sent)).toBe(0);
          expect(ctx.calls.readProfileArtifactContent).toBe(0);
        }
      );
    }
  );

  test("sends only selected artifacts, deduplicates events and paths, and allows later resends", async () => {
    const event = selected();
    await withArtifactChat(
      {
        deliverableArtifacts: [
          SAMPLE_ARTIFACT,
          {
            ...SAMPLE_ARTIFACT,
            filename: "unrelated.csv",
            path: "unrelated.csv",
          },
        ],
        toolEvents: [event, event, { ...event, toolCallId: "send_2" }],
      },
      async (ctx) => {
        await ctx.handleMessage({ jid: PAIRED_JID, text: "send report.md" });
        expect(documentSendCount(ctx.sent)).toBe(1);
        expect(ctx.calls.readProfileArtifactContent).toBe(1);
        expect(
          ctx.sessionStore.getDeliverableArtifacts(PAIRED_JID).at(-1)?.path
        ).toBe("report.md");
        await ctx.handleMessage({ jid: PAIRED_JID, text: "again" });
        expect(documentSendCount(ctx.sent)).toBe(2);
      }
    );
  });

  test("downloads selections through a pinned organization client", async () => {
    await withArtifactChat({ toolEvents: [selected()] }, async (ctx) => {
      let pinnedOrg: string | null = null;
      let reads = 0;
      const readContent = ctx.client.readProfileArtifactContent;
      ctx.client.forOrg = (orgId) => {
        pinnedOrg = orgId;
        return {
          readProfileArtifactContent: async (...args) => {
            reads += 1;
            return readContent(...args);
          },
        } as typeof ctx.client;
      };
      ctx.client.readProfileArtifactContent = async () => {
        throw new Error("Shared client must not be used for delivery");
      };
      await ctx.handleMessage({ jid: PAIRED_JID, text: "send report.md" });
      expect(pinnedOrg).toBeTruthy();
      expect(reads).toBe(1);
      expect(documentSendCount(ctx.sent)).toBe(1);
    });
  });

  test("records writes without implicitly uploading; a selected new file uploads once", async () => {
    for (const send of [false, true]) {
      await withArtifactChat(
        {
          messages: artifactMessages,
          toolEvents: [...writeEvents, ...(send ? [selected()] : [])],
        },
        async (ctx) => {
          await ctx.handleMessage({
            jid: PAIRED_JID,
            text: send ? "create and send" : "save only",
          });
          expect(documentSendCount(ctx.sent)).toBe(send ? 1 : 0);
          expect(
            ctx.sessionStore.getDeliverableArtifacts(PAIRED_JID).at(-1)?.path
          ).toBe("report.md");
          expect(ctx.calls.publishProfileArtifactShare).toBe(0);
        }
      );
    }
  });

  test("does not send selected documents on terminal failure, abort, or incomplete stream", async () => {
    for (const options of [
      { streamError: new Error("failed") },
      { streamError: new DOMException("Stopped", "AbortError") },
      { done: false },
    ]) {
      await withArtifactChat(
        {
          ...options,
          messages: artifactMessages,
          toolEvents: [...writeEvents, selected()],
        },
        async (ctx) => {
          await ctx.handleMessage({ jid: PAIRED_JID, text: "create and send" });
          expect(documentSendCount(ctx.sent)).toBe(0);
          expect(ctx.calls.readProfileArtifactContent).toBe(0);
          expect(
            ctx.sessionStore.getDeliverableArtifacts(PAIRED_JID).at(-1)?.path
          ).toBe("report.md");
        }
      );
    }
  });

  test("does not reconcile previous-turn writes when this request fails before persistence", async () => {
    await withArtifactChat(
      { messages: artifactMessages, streamError: new Error("request failed") },
      async (ctx) => {
        await ctx.handleMessage({ jid: PAIRED_JID, text: "send it" });
        expect(ctx.sessionStore.getDeliverableArtifacts(PAIRED_JID)).toEqual(
          []
        );
      }
    );
  });

  test("history-read failure does not discard a valid selection", async () => {
    await withArtifactChat(
      {
        getMessagesError: new Error("history unavailable"),
        toolEvents: [...writeEvents, selected()],
      },
      async (ctx) => {
        await ctx.handleMessage({ jid: PAIRED_JID, text: "create and send" });
        expect(documentSendCount(ctx.sent)).toBe(1);
      }
    );
  });

  test("does not upload bytes that changed after preparation or send later selections", async () => {
    await withArtifactChat(
      {
        toolEvents: [
          selected(
            "report.md",
            createHash("sha256").update("different bytes").digest("hex")
          ),
          { ...selected("other.md"), toolCallId: "send_2" },
        ],
      },
      async (ctx) => {
        await ctx.handleMessage({ jid: PAIRED_JID, text: "send reports" });
        expect(documentSendCount(ctx.sent)).toBe(0);
        expect(ctx.calls.readProfileArtifactContent).toBe(1);
        expect(
          ctx.sent.some((message) => message.text.includes("changed"))
        ).toBe(true);
        expect(ctx.sent.some((message) => message.text === "Agent reply")).toBe(
          false
        );
      }
    );
  });

  test("ignores invalid tool results rather than uploading arbitrary paths", async () => {
    await withArtifactChat(
      {
        toolEvents: [
          { ...selected(), result: { ok: true, path: "../secret" } },
        ],
      },
      async (ctx) => {
        await ctx.handleMessage({ jid: PAIRED_JID, text: "send" });
        expect(documentSendCount(ctx.sent)).toBe(0);
        expect(ctx.calls.readProfileArtifactContent).toBe(0);
      }
    );
  });

  test("a delivered document suppresses the empty reply placeholder", async () => {
    await withArtifactChat(
      { reply: "", toolEvents: [selected()] },
      async (ctx) => {
        await ctx.handleMessage({ jid: PAIRED_JID, text: "send report.md" });
        expect(documentSendCount(ctx.sent)).toBe(1);
        expect(
          ctx.sent.some((message) => message.text === "(empty reply)")
        ).toBe(false);
      }
    );
  });

  test("upload failure stops the batch and does not send the model's delivery promise", async () => {
    await withArtifactChat(
      {
        toolEvents: [
          selected(),
          { ...selected("other.csv"), toolCallId: "send_2" },
        ],
      },
      async (ctx) => {
        const texts: string[] = [];
        ctx.socket.sendMessage = async (_jid, content) => {
          if (content.document) {
            throw new Error("upload rejected");
          }
          if (typeof content.text === "string") {
            texts.push(content.text);
          }
        };
        await ctx.handleMessage({ jid: PAIRED_JID, text: "send reports" });
        expect(ctx.calls.readProfileArtifactContent).toBe(1);
        expect(ctx.sessionStore.getDeliverableArtifacts(PAIRED_JID)).toEqual(
          []
        );
        expect(hasActiveStreams()).toBe(false);
        expect(texts).not.toContain("Agent reply");
        expect(texts.some((text) => text.includes("upload rejected"))).toBe(
          true
        );
      }
    );
  });

  test("cancellation after the first confirmed upload stops later files and keeps the last sent artifact", async () => {
    await withArtifactChat(
      {
        toolEvents: [
          selected(),
          { ...selected("other.csv"), toolCallId: "send_2" },
        ],
      },
      async (ctx) => {
        const save = ctx.sessionStore.save.bind(ctx.sessionStore);
        ctx.sessionStore.save = async () => {
          await save();
          stopActiveStream(PAIRED_JID);
        };
        await ctx.handleMessage({ jid: PAIRED_JID, text: "send reports" });
        expect(documentSendCount(ctx.sent)).toBe(1);
        expect(ctx.calls.readProfileArtifactContent).toBe(1);
        expect(
          ctx.sessionStore.getDeliverableArtifacts(PAIRED_JID).at(-1)?.path
        ).toBe("report.md");
        expect(hasActiveStreams()).toBe(false);
      }
    );
  });

  test("in-flight cancellation leaves upload unknown and stops the remaining selections", async () => {
    await withArtifactChat(
      {
        toolEvents: [
          selected(),
          { ...selected("other.csv"), toolCallId: "send_2" },
        ],
      },
      async (ctx) => {
        let attempted = 0;
        ctx.socket.sendMessage = async (_jid, content) => {
          if (content.document) {
            attempted += 1;
            stopActiveStream(PAIRED_JID);
          }
        };
        await ctx.handleMessage({ jid: PAIRED_JID, text: "send reports" });
        expect(attempted).toBe(1);
        expect(ctx.calls.readProfileArtifactContent).toBe(1);
        expect(ctx.sessionStore.getDeliverableArtifacts(PAIRED_JID)).toEqual(
          []
        );
        expect(hasActiveStreams()).toBe(false);
      }
    );
  });

  test("uploads a selected artifact to the requesting group, never the paired private chat", async () => {
    await withArtifactChat({ toolEvents: [selected()] }, async (ctx) => {
      await ctx.handleMessage(
        groupInbound({
          mentionedJids: [BOT_ME.id],
          text: "@Nakama send report.md",
        })
      );
      const documents = ctx.sent.filter((message) => message.content.document);
      expect(documents).toHaveLength(1);
      expect(documents[0]?.jid).toBe(GROUP_JID);
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

describe("stream cleanup", () => {
  test("clears active stream after sendStream fails", async () => {
    await withTempHome(async (homeDir) => {
      await writeWhatsAppConfigIni(homeDir, {
        pairedJid: PAIRED_JID,
        phoneNumber: "1234567890",
      });

      const authStore = new WhatsAppAuthStore();
      await authStore.reload();
      const { client, getStreamControl } = createMockClient({
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

      const chatPromise = handleMessage({ jid: PAIRED_JID, text: "hello" });
      const control = await waitForStreamControl(getStreamControl);
      expect(hasActiveStreams()).toBe(true);

      control.fail(new Error("provider down"));
      await chatPromise;

      expect(hasActiveStreams()).toBe(false);
      expect(sent.some((message) => /provider down/i.test(message.text))).toBe(
        true
      );
    });
  });
});

describe("withChatLock", () => {
  test("keeps the lock chain rejection-safe across a failed prior run", async () => {
    const rejections: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      rejections.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      await expect(
        withChatLock("wa-lock-a", async () => {
          throw new Error("first failed");
        })
      ).rejects.toThrow("first failed");

      let ranSecond = false;
      await withChatLock("wa-lock-a", async () => {
        ranSecond = true;
      });

      await Promise.resolve();
      await Promise.resolve();

      expect(ranSecond).toBe(true);
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

describe("createChatHandler session hot cache", () => {
  test("reuses RemoteChatSession across messages without recreate", async () => {
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
      sessionStore.set(PAIRED_JID, {
        profileId: "default",
        sessionId: "session_test",
        updatedAt: new Date().toISOString(),
      });
      await sessionStore.save();
      const orgStore = createTestOrgStore(homeDir);
      await orgStore.load();
      const { socket } = createMockSocket();

      const handleMessage = createChatHandler({
        authStore,
        client,
        config: { phoneNumber: "1234567890", profileId: "default" },
        getSocket: () => socket as never,
        orgStore,
        sessionStore,
      });

      await handleMessage({ jid: PAIRED_JID, text: "one" });
      await handleMessage({ jid: PAIRED_JID, text: "two" });

      expect(calls.createSession).toBe(0);
      expect(calls.createChatSession).toBe(1);
      // Only the initial session validation reads history when there are no writes.
      expect(calls.getMessages).toBe(1);
      expect(calls.sendStream).toBe(2);
    });
  });
});
