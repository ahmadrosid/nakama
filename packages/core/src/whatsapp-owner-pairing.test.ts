import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ChannelIdentityInUseError } from "./channel-config-shared";
import { withTempHomedir } from "./testing/channel-config-fixtures";
import {
  loadWhatsAppConfigFile,
  saveWhatsAppConfig,
  syncWhatsAppOwnerPairing,
} from "./whatsapp-config";

describe("syncWhatsAppOwnerPairing", () => {
  test("auto-pairs owner when WhatsApp JID includes a device suffix", async () => {
    await withTempHomedir("nakama-core-wa-sync-", async () => {
      await saveWhatsAppConfig({ profileId: "default" });

      await syncWhatsAppOwnerPairing({
        ownerJid: "6281379292556:12@s.whatsapp.net",
        ownerLid: "236283431522503@lid",
      });

      const saved = await loadWhatsAppConfigFile();
      expect(saved?.phoneNumber).toBe("6281379292556");
      expect(saved?.pairedJid).toBe("6281379292556:12@s.whatsapp.net");
      expect(saved?.pairedLid).toBe("236283431522503@lid");
      expect(saved?.pairingCode).toBeNull();
    });
  });

  test("overwrites a stale phone number after QR link", async () => {
    await withTempHomedir("nakama-core-wa-sync-", async () => {
      await saveWhatsAppConfig({ phoneNumber: "+6281227900622" });

      await syncWhatsAppOwnerPairing({
        ownerJid: "6281379292556:17@s.whatsapp.net",
        ownerLid: "128415361462410:17@lid",
      });

      const saved = await loadWhatsAppConfigFile();
      expect(saved?.phoneNumber).toBe("6281379292556");
      expect(saved?.pairedJid).toBe("6281379292556:17@s.whatsapp.net");
    });
  });

  test("clears stale pairing code when owner pairing sync completes", async () => {
    await withTempHomedir("nakama-core-wa-sync-", async (tempHome) => {
      await saveWhatsAppConfig({ phoneNumber: "+6281379292556" });

      const dir = path.join(tempHome, ".nakama", "whatsapp");
      await writeFile(
        path.join(dir, "config.ini"),
        [
          "# Nakama WhatsApp bridge",
          "phone_number=+6281379292556",
          "profile_id=default",
          "pairing_code=ABCD1234",
          "paired_jid=6281379292556@s.whatsapp.net",
          "",
        ].join("\n"),
        "utf8"
      );

      await syncWhatsAppOwnerPairing({
        ownerJid: "6281379292556:12@s.whatsapp.net",
        ownerLid: "236283431522503@lid",
      });

      const saved = await loadWhatsAppConfigFile();
      expect(saved?.pairedJid).toBe("6281379292556@s.whatsapp.net");
      expect(saved?.pairedLid).toBe("236283431522503@lid");
      expect(saved?.pairingCode).toBeNull();
    });
  });

  test("preserves an existing paired LID during owner sync", async () => {
    await withTempHomedir("nakama-core-wa-sync-", async (tempHome) => {
      const dir = path.join(tempHome, ".nakama", "whatsapp");
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, "config.ini"),
        [
          "# Nakama WhatsApp bridge",
          "phone_number=6281379292556",
          "profile_id=default",
          "paired_jid=6281379292556@s.whatsapp.net",
          "paired_lid=104784384290844@lid",
          "",
        ].join("\n"),
        "utf8"
      );

      await syncWhatsAppOwnerPairing({
        ownerJid: "6281379292556:18@s.whatsapp.net",
        ownerLid: "128415361462410:18@lid",
      });

      const saved = await loadWhatsAppConfigFile();
      expect(saved?.pairedJid).toBe("6281379292556@s.whatsapp.net");
      expect(saved?.pairedLid).toBe("104784384290844@lid");
    });
  });

  test("claims one owner JID across concurrent owners", async () => {
    await withTempHomedir("nakama-whatsapp-claim-race-", async () => {
      const first = { orgId: "org_a", profileId: "a" };
      const second = { orgId: "org_b", profileId: "b" };
      await saveWhatsAppConfig({ profileId: "a" }, first);
      await saveWhatsAppConfig({ profileId: "b" }, second);

      const results = await Promise.allSettled([
        syncWhatsAppOwnerPairing(
          { ownerJid: "6281379292556@s.whatsapp.net" },
          first
        ),
        syncWhatsAppOwnerPairing(
          { ownerJid: "6281379292556@s.whatsapp.net" },
          second
        ),
      ]);

      expect(
        results.filter((result) => result.status === "fulfilled")
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.status === "rejected")
      ).toHaveLength(1);
    });
  });

  test("a rejected claim names the owner that holds the JID", async () => {
    await withTempHomedir("nakama-whatsapp-claim-owner-", async () => {
      const first = { orgId: "org_a", profileId: "a" };
      const second = { orgId: "org_b", profileId: "b" };
      await saveWhatsAppConfig({ profileId: "a" }, first);
      await saveWhatsAppConfig({ profileId: "b" }, second);
      await syncWhatsAppOwnerPairing(
        { ownerJid: "6281379292556@s.whatsapp.net" },
        first
      );

      const rejected = syncWhatsAppOwnerPairing(
        { ownerJid: "6281379292556@s.whatsapp.net" },
        second
      );

      await expect(rejected).rejects.toBeInstanceOf(ChannelIdentityInUseError);
      await expect(rejected).rejects.toMatchObject({ owner: first });
    });
  });
});
