import { describe, expect, test } from "bun:test";
import { maskWhatsAppJid } from "./log-metadata";

describe("WhatsApp log metadata", () => {
  test("masks account identifiers while preserving routing metadata", () => {
    expect(maskWhatsAppJid("6281379292556@s.whatsapp.net")).toBe(
      "***2556@s.whatsapp.net"
    );
    expect(maskWhatsAppJid("6281379292556:12@s.whatsapp.net")).toBe(
      "***2556:12@s.whatsapp.net"
    );
    expect(maskWhatsAppJid("120363042000000000@g.us")).toBe("***0000@g.us");
    expect(maskWhatsAppJid("1234@lid")).toBe("***@lid");
    expect(maskWhatsAppJid(null)).toBe("-");
  });
});
