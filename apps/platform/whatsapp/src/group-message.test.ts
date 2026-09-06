import { describe, expect, test } from "bun:test";
import {
  explainGroupMessageHandling,
  extraJidsFromGroupParticipants,
  isWhatsAppBotAddress,
  isWhatsAppGroupChat,
  resolveChannelOrgKey,
  stripWhatsAppBotMention,
  type WhatsAppAccount,
} from "./group-message";

const me: WhatsAppAccount = {
  id: "628100000000@s.whatsapp.net",
  lid: "236283431522503@lid",
};

describe("group-message helpers", () => {
  test("isWhatsAppGroupChat detects group JIDs", () => {
    expect(isWhatsAppGroupChat("120363@g.us")).toBe(true);
    expect(isWhatsAppGroupChat("628100000000@s.whatsapp.net")).toBe(false);
    expect(isWhatsAppGroupChat("236283431522503@lid")).toBe(false);
  });

  test("resolveChannelOrgKey scopes org store by group or private chat", () => {
    expect(resolveChannelOrgKey("120363@g.us", true)).toBe("g:120363@g.us");
    expect(resolveChannelOrgKey("628100000000@s.whatsapp.net", false)).toBe(
      "628100000000@s.whatsapp.net"
    );
  });

  test("isWhatsAppBotAddress matches phone and lid identities", () => {
    expect(isWhatsAppBotAddress("628100000000@s.whatsapp.net", me)).toBe(true);
    expect(isWhatsAppBotAddress("628100000000:12@s.whatsapp.net", me)).toBe(
      true
    );
    expect(isWhatsAppBotAddress("236283431522503@lid", me)).toBe(true);
    expect(isWhatsAppBotAddress("9999999999@s.whatsapp.net", me)).toBe(false);
  });

  test("explainGroupMessageHandling accepts mention, reply, and slash commands", () => {
    expect(
      explainGroupMessageHandling({
        me,
        mentionedJids: ["628100000000@s.whatsapp.net"],
        quotedParticipant: null,
        text: "@Nakama hello",
      }).shouldHandle
    ).toBe(true);

    expect(
      explainGroupMessageHandling({
        me,
        mentionedJids: [],
        quotedParticipant: null,
        text: "hello",
      }).shouldHandle
    ).toBe(false);

    expect(
      explainGroupMessageHandling({
        me,
        mentionedJids: [],
        quotedParticipant: me.lid ?? null,
        text: "follow up",
      }).shouldHandle
    ).toBe(true);

    expect(
      explainGroupMessageHandling({
        me,
        mentionedJids: [],
        quotedParticipant: null,
        text: "/status",
      }).shouldHandle
    ).toBe(true);
  });

  test("explainGroupMessageHandling accepts plain text when mention is not required", () => {
    expect(
      explainGroupMessageHandling({
        mentionedJids: [],
        quotedParticipant: null,
        requireMention: false,
        text: "hello",
      })
    ).toEqual({ reason: "open-listen", shouldHandle: true });
  });

  test("explainGroupMessageHandling ignores non-slash messages without bot info", () => {
    expect(
      explainGroupMessageHandling({
        mentionedJids: ["628100000000@s.whatsapp.net"],
        quotedParticipant: null,
        text: "hello",
      })
    ).toEqual({ reason: "missing-bot-info", shouldHandle: false });
  });

  test("extraJidsFromGroupParticipants maps a group LID to the phone JID", () => {
    expect(
      extraJidsFromGroupParticipants(
        [
          {
            id: "104784384290844@lid",
            jid: "6281352311912@s.whatsapp.net",
          },
        ],
        ["104784384290844@lid"]
      )
    ).toEqual(["104784384290844@lid", "6281352311912@s.whatsapp.net"]);
  });

  test("stripWhatsAppBotMention removes @mention tokens", () => {
    expect(stripWhatsAppBotMention("hi @Nakama there")).toBe("hi there");
    expect(stripWhatsAppBotMention("@Nakama")).toBe("");
  });
});
