import { describe, expect, test } from "bun:test";
import {
  extractInboundText,
  isPrivateWhatsAppChat,
  isSelfWhatsAppChat,
  isWhatsAppOutboundEcho,
  parseInboundWhatsAppMessage,
  rememberWhatsAppOutbound,
  resetWhatsAppOutboundForTests,
  shouldHandleInboundMessage,
} from "./inbound-message";

const ME = {
  id: "6281379292556@s.whatsapp.net",
  lid: "236283431522503@lid",
};

describe("inbound message routing", () => {
  test("treats remembered fromMe group replies as outbound echoes", () => {
    resetWhatsAppOutboundForTests();
    rememberWhatsAppOutbound({
      id: "out-1",
      jid: "120363@g.us",
      text: "Hi! Silakan kirim laporan well test yang ingin divalidasi.",
    });

    expect(
      isWhatsAppOutboundEcho({
        fromMe: true,
        id: "out-1",
        jid: "120363@g.us",
        text: "Hi! Silakan kirim laporan well test yang ingin divalidasi.",
      })
    ).toBe(true);
    expect(
      isWhatsAppOutboundEcho({
        fromMe: true,
        jid: "120363@g.us",
        text: "hi",
      })
    ).toBe(false);
    expect(
      isWhatsAppOutboundEcho({
        fromMe: false,
        id: "out-1",
        jid: "120363@g.us",
        text: "Hi! Silakan kirim laporan well test yang ingin divalidasi.",
      })
    ).toBe(false);
  });

  test("accepts private phone and lid chats", () => {
    expect(isPrivateWhatsAppChat("6281379292556@s.whatsapp.net")).toBe(true);
    expect(isPrivateWhatsAppChat("236283431522503@lid")).toBe(true);
    expect(isPrivateWhatsAppChat("123@g.us")).toBe(false);
  });

  test("handles message-yourself traffic marked fromMe", () => {
    const me = {
      id: "6281379292556@s.whatsapp.net",
      lid: "236283431522503@lid",
    };

    expect(
      shouldHandleInboundMessage(
        {
          key: { fromMe: true, remoteJid: "236283431522503@lid" },
          message: { conversation: "hello" },
        },
        me
      )
    ).toBe(true);
    expect(isSelfWhatsAppChat("236283431522503@lid", me)).toBe(true);
  });

  test("ignores fromMe messages in other chats", () => {
    expect(
      shouldHandleInboundMessage(
        {
          key: { fromMe: true, remoteJid: "9999999999@s.whatsapp.net" },
          message: { conversation: "hello" },
        },
        { id: "6281379292556@s.whatsapp.net", lid: "236283431522503@lid" }
      )
    ).toBe(false);
  });

  test("extracts text from ephemeral wrapped messages", () => {
    expect(
      extractInboundText({
        ephemeralMessage: {
          message: {
            extendedTextMessage: {
              text: "hello from wrapper",
            },
          },
        },
      } as any)
    ).toBe("hello from wrapper");
  });

  test("extracts text from protobuf-like messages that only expose text via JSON", () => {
    const payload = {
      extendedTextMessage: {
        get text() {},
        toJSON() {
          return { text: "hi from toJSON" };
        },
      },
      toJSON() {
        return {
          extendedTextMessage: {
            text: "hi from toJSON",
          },
        };
      },
    };

    expect(extractInboundText(payload as any)).toBe("hi from toJSON");
  });

  test("ignores group messages without a mention, reply, or slash command", () => {
    expect(
      shouldHandleInboundMessage(
        {
          key: {
            participant: "9999999999@s.whatsapp.net",
            remoteJid: "120363@g.us",
          },
          message: { conversation: "hello everyone" },
        },
        ME
      )
    ).toBe(false);
  });

  test("handles plain group messages when mention is not required", () => {
    expect(
      shouldHandleInboundMessage(
        {
          key: {
            participant: "9999999999@s.whatsapp.net",
            remoteJid: "120363@g.us",
          },
          message: { conversation: "hello everyone" },
        },
        ME,
        { requireGroupMention: false }
      )
    ).toBe(true);
  });

  test("handles group mentions, replies, and slash commands", () => {
    expect(
      shouldHandleInboundMessage(
        {
          key: {
            participant: "9999999999@s.whatsapp.net",
            remoteJid: "120363@g.us",
          },
          message: {
            extendedTextMessage: {
              contextInfo: { mentionedJid: [ME.id] },
              text: "@Nakama hello",
            },
          },
        },
        ME
      )
    ).toBe(true);

    expect(
      shouldHandleInboundMessage(
        {
          key: {
            participant: "9999999999@s.whatsapp.net",
            remoteJid: "120363@g.us",
          },
          message: {
            extendedTextMessage: {
              contextInfo: { participant: ME.lid },
              text: "follow up",
            },
          },
        },
        ME
      )
    ).toBe(true);

    expect(
      shouldHandleInboundMessage(
        {
          key: { fromMe: true, remoteJid: "120363@g.us" },
          message: { conversation: "/status" },
        },
        ME
      )
    ).toBe(true);
  });

  test("parseInboundWhatsAppMessage keeps group sender and chat JIDs separate", () => {
    const inbound = parseInboundWhatsAppMessage(
      {
        key: {
          participant: "104784384290844@lid",
          participantPn: "9999999999@s.whatsapp.net",
          remoteJid: "120363@g.us",
        },
        message: {
          extendedTextMessage: {
            contextInfo: { mentionedJid: [ME.lid] },
            text: "@Nakama hello",
          },
        },
      },
      ME
    );

    expect(inbound).toEqual({
      fromMe: false,
      isGroup: true,
      jid: "120363@g.us",
      me: ME,
      mentionedJids: [ME.lid],
      messageId: null,
      quotedParticipant: null,
      quotedText: null,
      senderJid: "9999999999@s.whatsapp.net",
      senderJids: ["9999999999@s.whatsapp.net", "104784384290844@lid"],
      text: "@Nakama hello",
    });
  });

  test("parseInboundWhatsAppMessage keeps quoted message text", () => {
    const inbound = parseInboundWhatsAppMessage(
      {
        key: {
          participant: "9999999999@s.whatsapp.net",
          remoteJid: "120363@g.us",
        },
        message: {
          extendedTextMessage: {
            contextInfo: {
              mentionedJid: [ME.id],
              participant: "6281352311912@s.whatsapp.net",
              quotedMessage: {
                conversation:
                  "Update Daily Well PHSS 20-08-2026\nSFT-01 Unload flow",
              },
            },
            text: "@Nakama ini data laporan hari berikutnya",
          },
        },
      },
      ME
    );

    expect(inbound?.quotedParticipant).toBe("6281352311912@s.whatsapp.net");
    expect(inbound?.quotedText).toBe(
      "Update Daily Well PHSS 20-08-2026\nSFT-01 Unload flow"
    );
    expect(inbound?.text).toBe("@Nakama ini data laporan hari berikutnya");
  });
});
