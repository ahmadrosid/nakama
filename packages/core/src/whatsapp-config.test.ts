import { mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  generatePairingCode,
  isWhatsAppUserAuthorized,
  loadWhatsAppConfigFile,
  maskPhoneNumber,
  normalizePairingCode,
  regenerateWhatsAppPairingCode,
  resetWhatsAppSessionForReconnect,
  resolveWhatsAppConfigFromSources,
  saveWhatsAppConfig,
  syncWhatsAppOwnerPairing,
} from "./whatsapp-config";

describe("maskPhoneNumber", () => {
  test("masks long phone numbers with plus prefix", () => {
    expect(maskPhoneNumber("+1234567890")).toBe("+\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u202290");
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
  test("returns true when JID matches pairedLid", () => {
    expect(
      isWhatsAppUserAuthorized("236283431522503@lid", {
        pairedJid: "6281379292556@s.whatsapp.net",
        pairedLid: "236283431522503@lid",
      }),
    ).toBe(true);
  });

  test("returns true when JID matches pairedJid", () => {
    expect(
      isWhatsAppUserAuthorized("1234567890@s.whatsapp.net", {
        pairedJid: "1234567890@s.whatsapp.net",
        pairedLid: null,
      }),
    ).toBe(true);
  });

  test("returns true when inbound JID includes a device suffix", () => {
    expect(
      isWhatsAppUserAuthorized("6281379292556:12@s.whatsapp.net", {
        pairedJid: "6281379292556@s.whatsapp.net",
        pairedLid: null,
      }),
    ).toBe(true);
  });

  test("returns true when pairedJid includes a device suffix", () => {
    expect(
      isWhatsAppUserAuthorized("6281379292556@s.whatsapp.net", {
        pairedJid: "6281379292556:12@s.whatsapp.net",
        pairedLid: null,
      }),
    ).toBe(true);
  });

  test("returns false when JID does not match pairedJid", () => {
    expect(
      isWhatsAppUserAuthorized("9999999999@s.whatsapp.net", {
        pairedJid: "1234567890@s.whatsapp.net",
        pairedLid: null,
      }),
    ).toBe(false);
  });

  test("returns false when pairedJid is null", () => {
    expect(
      isWhatsAppUserAuthorized("1234567890@s.whatsapp.net", {
        pairedJid: null,
        pairedLid: null,
      }),
    ).toBe(false);
  });
});

describe("generatePairingCode", () => {
  test("returns 8 uppercase hex chars", () => {
    expect(generatePairingCode()).toMatch(/^[0-9A-F]{8}$/);
  });
});

describe("saveWhatsAppConfig", () => {
  let tempHome = "";
  let homedirSpy: ReturnType<typeof spyOn<typeof os, "homedir">> | null = null;

  afterEach(async () => {
    homedirSpy?.mockRestore();
    homedirSpy = null;

    if (tempHome) {
      await rm(tempHome, { recursive: true, force: true });
      tempHome = "";
    }
  });

  async function useTempWhatsAppHome(run: () => Promise<void>): Promise<void> {
    tempHome = await mkdtemp(path.join(os.tmpdir(), "nakama-core-wa-home-"));
    homedirSpy = spyOn(os, "homedir").mockReturnValue(tempHome);
    await run();
  }

  test("creates config without auto-generating a pairing code", async () => {
    await useTempWhatsAppHome(async () => {
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

  test("saves profile without requiring a phone number", async () => {
    await useTempWhatsAppHome(async () => {
      const result = await saveWhatsAppConfig({
        profileId: "profile_custom",
      });

      expect(result.profileId).toBe("profile_custom");

      const saved = await loadWhatsAppConfigFile();
      expect(saved?.profileId).toBe("profile_custom");
    });
  });

  test("preserves pairedJid when updating other fields", async () => {
    await useTempWhatsAppHome(async () => {
      await saveWhatsAppConfig({ phoneNumber: "+1234567890" });
      const first = await loadWhatsAppConfigFile();

      const configWithJid: Record<string, string> = {
        phone_number: first!.phoneNumber,
        profile_id: first!.profileId,
        pairing_code: first!.pairingCode!,
        paired_jid: "1234567890@s.whatsapp.net",
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

  test("allows first save with profile only", async () => {
    await useTempWhatsAppHome(async () => {
      const result = await saveWhatsAppConfig({ profileId: "default" });
      expect(result.configured).toBe(true);
    });
  });
});

describe("resetWhatsAppSessionForReconnect", () => {
  let tempHome = "";
  let homedirSpy: ReturnType<typeof spyOn<typeof os, "homedir">> | null = null;

  afterEach(async () => {
    homedirSpy?.mockRestore();
    homedirSpy = null;

    if (tempHome) {
      await rm(tempHome, { recursive: true, force: true });
      tempHome = "";
    }
  });

  async function useTempWhatsAppHome(run: () => Promise<void>): Promise<void> {
    tempHome = await mkdtemp(path.join(os.tmpdir(), "nakama-core-wa-reset-"));
    homedirSpy = spyOn(os, "homedir").mockReturnValue(tempHome);
    await run();
  }

  test("clears auth dir, pairing fields, and QR while preserving phone and profile", async () => {
    await useTempWhatsAppHome(async () => {
      await saveWhatsAppConfig({ phoneNumber: "+1234567890", profileId: "profile_custom" });
      const dir = path.join(tempHome, ".nakama", "whatsapp");
      const authDir = path.join(dir, "auth");
      await mkdir(authDir, { recursive: true });
      await writeFile(path.join(authDir, "creds.json"), "{}", "utf8");
      await writeFile(path.join(dir, "worker-qr.txt"), "qr-string", "utf8");

      const first = await loadWhatsAppConfigFile();
      const configWithJid: Record<string, string> = {
        phone_number: first!.phoneNumber,
        profile_id: first!.profileId,
        paired_jid: "1234567890@s.whatsapp.net",
        paired_lid: "999@lid",
      };
      await writeFile(
        path.join(dir, "config.ini"),
        ["# Nakama WhatsApp bridge", ...Object.entries(configWithJid).map(([k, v]) => `${k}=${v}`), ""].join("\n"),
        "utf8",
      );

      const result = await resetWhatsAppSessionForReconnect();

      expect(result.configured).toBe(true);
      expect(result.profileId).toBe("profile_custom");
      expect(result.phoneNumberMasked).toBe("+\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u202290");
      expect(result.pairedJid).toBeNull();
      expect(result.pairingCode).toBeNull();

      const saved = await loadWhatsAppConfigFile();
      expect(saved?.pairedJid).toBeNull();
      expect(saved?.pairedLid).toBeNull();
      expect(saved?.pairingCode).toBeNull();
      expect(saved?.phoneNumber).toBe("+1234567890");

      await expect(Bun.file(path.join(authDir, "creds.json")).exists()).resolves.toBe(false);
      await expect(Bun.file(path.join(dir, "worker-qr.txt")).exists()).resolves.toBe(false);
    });
  });

  test("throws when WhatsApp is not configured", async () => {
    await useTempWhatsAppHome(async () => {
      expect(resetWhatsAppSessionForReconnect()).rejects.toThrow(
        "Enable WhatsApp in Integrations before reconnecting.",
      );
    });
  });

  test("succeeds when auth dir and QR file are already absent", async () => {
    await useTempWhatsAppHome(async () => {
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
      }),
    ).toBeNull();
  });

  test("prefers env phone number over file config", () => {
    const resolved = resolveWhatsAppConfigFromSources({
      env: {
        WHATSAPP_PHONE_NUMBER: "+1234567890",
      },
      file: {
        phoneNumber: "+9876543210",
        profileId: "profile_from_file",
        pairingCode: null,
        pairedJid: null,
        pairedLid: null,
      },
    });

    expect(resolved).toEqual({
      phoneNumber: "+1234567890",
      profileId: "profile_from_file",
      pairingCode: null,
      pairedJid: null,
      pairedLid: null,
    });
  });

  test("uses file config when env is absent", () => {
    const resolved = resolveWhatsAppConfigFromSources({
      env: {},
      file: {
        phoneNumber: "",
        profileId: "profile_from_file",
        pairingCode: "ABCD1234",
        pairedJid: "9876543210@s.whatsapp.net",
        pairedLid: null,
      },
    });

    expect(resolved?.phoneNumber).toBe("");
    expect(resolved?.pairedJid).toBe("9876543210@s.whatsapp.net");
  });
});

describe("syncWhatsAppOwnerPairing", () => {
  let tempHome = "";
  let homedirSpy: ReturnType<typeof spyOn<typeof os, "homedir">> | null = null;

  afterEach(async () => {
    homedirSpy?.mockRestore();
    homedirSpy = null;

    if (tempHome) {
      await rm(tempHome, { recursive: true, force: true });
      tempHome = "";
    }
  });

  test("auto-pairs owner when WhatsApp JID includes a device suffix", async () => {
    tempHome = await mkdtemp(path.join(os.tmpdir(), "nakama-core-wa-sync-"));
    homedirSpy = spyOn(os, "homedir").mockReturnValue(tempHome);

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

  test("overwrites a stale phone number after QR link", async () => {
    tempHome = await mkdtemp(path.join(os.tmpdir(), "nakama-core-wa-sync-"));
    homedirSpy = spyOn(os, "homedir").mockReturnValue(tempHome);

    await saveWhatsAppConfig({ phoneNumber: "+6281227900622" });

    await syncWhatsAppOwnerPairing({
      ownerJid: "6281379292556:17@s.whatsapp.net",
      ownerLid: "128415361462410:17@lid",
    });

    const saved = await loadWhatsAppConfigFile();
    expect(saved?.phoneNumber).toBe("6281379292556");
    expect(saved?.pairedJid).toBe("6281379292556:17@s.whatsapp.net");
  });

  test("clears stale pairing code when owner pairing sync completes", async () => {
    tempHome = await mkdtemp(path.join(os.tmpdir(), "nakama-core-wa-sync-"));
    homedirSpy = spyOn(os, "homedir").mockReturnValue(tempHome);

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
      "utf8",
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

  test("preserves an existing paired LID during owner sync", async () => {
    tempHome = await mkdtemp(path.join(os.tmpdir(), "nakama-core-wa-sync-"));
    homedirSpy = spyOn(os, "homedir").mockReturnValue(tempHome);

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
      "utf8",
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
