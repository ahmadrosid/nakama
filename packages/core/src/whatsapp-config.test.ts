import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { withTempHomedir } from "./testing/channel-config-fixtures";
import {
  generatePairingCode,
  isWhatsAppUserAuthorized,
  loadWhatsAppConfigFile,
  maskPhoneNumber,
  normalizePairingCode,
  parseAllowedWhatsAppPhones,
  resetWhatsAppSessionForReconnect,
  resolveWhatsAppConfigFromSources,
  saveWhatsAppConfig,
  syncWhatsAppOwnerPairing,
} from "./whatsapp-config";

describe("maskPhoneNumber", () => {
  test("masks long phone numbers with plus prefix", () => {
    expect(maskPhoneNumber("+1234567890")).toBe(
      "+\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u202290"
    );
  });

  test("returns null for empty", () => {
    expect(maskPhoneNumber("")).toBeNull();
  });

  test("masks short numbers", () => {
    expect(maskPhoneNumber("1234")).toBe("+••••");
  });
});

describe("normalizePairingCode", () => {
  test("strips spaces and uppercases", () => {
    expect(normalizePairingCode(" a b cd12 ")).toBe("ABCD12");
  });
});

describe("isWhatsAppUserAuthorized", () => {
  const cases: Array<{
    jid: string | readonly string[];
    access: Parameters<typeof isWhatsAppUserAuthorized>[1];
    ok: boolean;
  }> = [
    {
      access: {
        pairedJid: "6281379292556@s.whatsapp.net",
        pairedLid: "236283431522503@lid",
      },
      jid: "236283431522503@lid",
      ok: true,
    },
    {
      access: { pairedJid: "1234567890@s.whatsapp.net", pairedLid: null },
      jid: "1234567890@s.whatsapp.net",
      ok: true,
    },
    {
      access: { pairedJid: "6281379292556@s.whatsapp.net", pairedLid: null },
      jid: "6281379292556:12@s.whatsapp.net",
      ok: true,
    },
    {
      access: {
        pairedJid: "6281379292556@s.whatsapp.net",
        pairedLid: "128415361462410:25@lid",
      },
      jid: "128415361462410@lid",
      ok: true,
    },
    {
      access: {
        pairedJid: "6281379292556:12@s.whatsapp.net",
        pairedLid: null,
      },
      jid: "6281379292556@s.whatsapp.net",
      ok: true,
    },
    {
      access: { pairedJid: "1234567890@s.whatsapp.net", pairedLid: null },
      jid: "9999999999@s.whatsapp.net",
      ok: false,
    },
    {
      access: { pairedJid: null, pairedLid: null },
      jid: "1234567890@s.whatsapp.net",
      ok: false,
    },
    {
      access: { pairedJid: "1234567890@s.whatsapp.net", pairedLid: null },
      jid: ["104784384290844@lid", "1234567890@s.whatsapp.net"],
      ok: true,
    },
    {
      access: {
        allowedPhones: ["628111111111"],
        pairedJid: "1234567890@s.whatsapp.net",
        pairedLid: null,
      },
      jid: "628111111111@s.whatsapp.net",
      ok: true,
    },
  ];

  test("authorizes paired JIDs, LIDs, device suffixes, and allowlisted phones", () => {
    for (const { jid, access, ok } of cases) {
      expect(isWhatsAppUserAuthorized(jid, access)).toBe(ok);
    }
  });
});

describe("parseAllowedWhatsAppPhones", () => {
  test("normalizes country-code numbers", () => {
    expect(
      parseAllowedWhatsAppPhones("+62 811-1111-1111, 628222222222")
    ).toEqual(["6281111111111", "628222222222"]);
  });

  test("rejects short numbers", () => {
    expect(() => parseAllowedWhatsAppPhones("123")).toThrow();
  });
});

describe("generatePairingCode", () => {
  test("returns 8 uppercase hex chars", () => {
    expect(generatePairingCode()).toMatch(/^[0-9A-F]{8}$/);
  });
});

describe("saveWhatsAppConfig", () => {
  test("creates config without auto-generating a pairing code", async () => {
    await withTempHomedir("nakama-core-wa-home-", async () => {
      const result = await saveWhatsAppConfig({ profileId: "profile_custom" });

      expect(result.pairingCode).toBeNull();
      expect(result.configured).toBe(true);
      expect(result.phoneNumberMasked).toBeNull();
      expect(result.pairedJid).toBeNull();

      const saved = await loadWhatsAppConfigFile();
      expect(saved?.phoneNumber).toBe("");
      expect(saved?.profileId).toBe("profile_custom");
      expect(saved?.pairingCode).toBeNull();
    });
  });

  test("preserves pairedJid when updating other fields", async () => {
    await withTempHomedir("nakama-core-wa-home-", async (tempHome) => {
      await saveWhatsAppConfig({ phoneNumber: "+1234567890" });
      const first = await loadWhatsAppConfigFile();

      const configWithJid: Record<string, string> = {
        paired_jid: "1234567890@s.whatsapp.net",
        pairing_code: first!.pairingCode!,
        phone_number: first!.phoneNumber,
        profile_id: first!.profileId,
      };
      const dir = path.join(tempHome, ".nakama", "whatsapp");
      const lines = [
        "# Nakama WhatsApp bridge",
        ...Object.entries(configWithJid).map(([k, v]) => `${k}=${v}`),
        "",
      ];
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "config.ini"), lines.join("\n"), "utf8");

      const result = await saveWhatsAppConfig({
        profileId: "profile_updated",
      });

      expect(result.pairedJid).toBe("1234567890@s.whatsapp.net");
      expect(result.profileId).toBe("profile_updated");
    });
  });

  test("saves allowed phones", async () => {
    await withTempHomedir("nakama-core-wa-home-", async () => {
      const result = await saveWhatsAppConfig({
        allowedPhones: "+62 811-1111-1111, 628222222222",
        profileId: "default",
      });

      expect(result.allowedPhones).toEqual(["6281111111111", "628222222222"]);

      const saved = await loadWhatsAppConfigFile();
      expect(saved?.allowedPhones).toEqual(["6281111111111", "628222222222"]);
    });
  });

  test("saves requireGroupMention and defaults to true when omitted", async () => {
    await withTempHomedir("nakama-core-wa-home-", async () => {
      const created = await saveWhatsAppConfig({ profileId: "default" });
      expect(created.requireGroupMention).toBe(true);
      expect((await loadWhatsAppConfigFile())?.requireGroupMention).toBe(true);

      const updated = await saveWhatsAppConfig({
        requireGroupMention: false,
      });
      expect(updated.requireGroupMention).toBe(false);
      expect((await loadWhatsAppConfigFile())?.requireGroupMention).toBe(false);

      const preserved = await saveWhatsAppConfig({ profileId: "default" });
      expect(preserved.requireGroupMention).toBe(false);
    });
  });
});

describe("resetWhatsAppSessionForReconnect", () => {
  test("clears auth dir, pairing fields, and QR while preserving phone and profile", async () => {
    await withTempHomedir("nakama-core-wa-reset-", async (tempHome) => {
      await saveWhatsAppConfig({
        phoneNumber: "+1234567890",
        profileId: "profile_custom",
      });
      const dir = path.join(tempHome, ".nakama", "whatsapp");
      const authDir = path.join(dir, "auth");
      await mkdir(authDir, { recursive: true });
      await writeFile(path.join(authDir, "creds.json"), "{}", "utf8");
      await writeFile(path.join(dir, "worker-qr.txt"), "qr-string", "utf8");

      const first = await loadWhatsAppConfigFile();
      const configWithJid: Record<string, string> = {
        paired_jid: "1234567890@s.whatsapp.net",
        paired_lid: "999@lid",
        phone_number: first!.phoneNumber,
        profile_id: first!.profileId,
      };
      await writeFile(
        path.join(dir, "config.ini"),
        [
          "# Nakama WhatsApp bridge",
          ...Object.entries(configWithJid).map(([k, v]) => `${k}=${v}`),
          "",
        ].join("\n"),
        "utf8"
      );

      const result = await resetWhatsAppSessionForReconnect();

      expect(result.configured).toBe(true);
      expect(result.profileId).toBe("profile_custom");
      expect(result.phoneNumberMasked).toBe(
        "+\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u202290"
      );
      expect(result.pairedJid).toBeNull();
      expect(result.pairingCode).toBeNull();

      const saved = await loadWhatsAppConfigFile();
      expect(saved?.pairedJid).toBeNull();
      expect(saved?.pairedLid).toBeNull();
      expect(saved?.pairingCode).toBeNull();
      expect(saved?.phoneNumber).toBe("+1234567890");

      await expect(
        Bun.file(path.join(authDir, "creds.json")).exists()
      ).resolves.toBe(false);
      await expect(
        Bun.file(path.join(dir, "worker-qr.txt")).exists()
      ).resolves.toBe(false);
    });
  });

  test("throws when WhatsApp is not configured", async () => {
    await withTempHomedir("nakama-core-wa-reset-", async () => {
      expect(resetWhatsAppSessionForReconnect()).rejects.toThrow(
        "Enable WhatsApp in Integrations before reconnecting."
      );
    });
  });

  test("succeeds when auth dir and QR file are already absent", async () => {
    await withTempHomedir("nakama-core-wa-reset-", async () => {
      await saveWhatsAppConfig({ phoneNumber: "+1234567890" });

      const result = await resetWhatsAppSessionForReconnect();
      expect(result.pairedJid).toBeNull();

      const again = await resetWhatsAppSessionForReconnect();
      expect(again.pairedJid).toBeNull();
    });
  });
});

describe("resolveWhatsAppConfigFromSources", () => {
  test("returns null when no config file is available", () => {
    expect(
      resolveWhatsAppConfigFromSources({
        env: {},
        file: null,
      })
    ).toBeNull();
  });

  test("prefers env phone number over file config", () => {
    const resolved = resolveWhatsAppConfigFromSources({
      env: {
        WHATSAPP_PHONE_NUMBER: "+1234567890",
      },
      file: {
        allowedPhones: [],
        pairedJid: null,
        pairedLid: null,
        pairingCode: null,
        phoneNumber: "+9876543210",
        profileId: "profile_from_file",
        requireGroupMention: true,
      },
    });

    expect(resolved).toEqual({
      allowedPhones: [],
      pairedJid: null,
      pairedLid: null,
      pairingCode: null,
      phoneNumber: "+1234567890",
      profileId: "profile_from_file",
      requireGroupMention: true,
    });
  });

  test("uses file config when env is absent", () => {
    const resolved = resolveWhatsAppConfigFromSources({
      env: {},
      file: {
        allowedPhones: ["628111111111"],
        pairedJid: "9876543210@s.whatsapp.net",
        pairedLid: null,
        pairingCode: "ABCD1234",
        phoneNumber: "",
        profileId: "profile_from_file",
        requireGroupMention: false,
      },
    });

    expect(resolved?.phoneNumber).toBe("");
    expect(resolved?.pairedJid).toBe("9876543210@s.whatsapp.net");
    expect(resolved?.requireGroupMention).toBe(false);
  });
});

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
});
