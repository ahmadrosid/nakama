import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  generatePairingCode,
  isWhatsAppUserAuthorized,
  loadWhatsAppConfigFile,
  maskPhoneNumber,
  normalizePairingCode,
  resolveWhatsAppConfigFromSources,
  saveWhatsAppConfig,
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
  test("returns true when JID matches pairedJid", () => {
    expect(
      isWhatsAppUserAuthorized("1234567890@s.whatsapp.net", {
        pairedJid: "1234567890@s.whatsapp.net",
      }),
    ).toBe(true);
  });

  test("returns false when JID does not match pairedJid", () => {
    expect(
      isWhatsAppUserAuthorized("9999999999@s.whatsapp.net", {
        pairedJid: "1234567890@s.whatsapp.net",
      }),
    ).toBe(false);
  });

  test("returns false when pairedJid is null", () => {
    expect(
      isWhatsAppUserAuthorized("1234567890@s.whatsapp.net", {
        pairedJid: null,
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
    tempHome = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-core-wa-home-"));
    homedirSpy = spyOn(os, "homedir").mockReturnValue(tempHome);
    await run();
  }

  test("generates a pairing code for a new config", async () => {
    await useTempWhatsAppHome(async () => {
      const result = await saveWhatsAppConfig({ phoneNumber: "+1234567890" });

      expect(result.pairingCode).toMatch(/^[0-9A-F]{8}$/);
      expect(result.configured).toBe(true);
      expect(result.phoneNumberMasked).toBe("+\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u202290");
      expect(result.pairedJid).toBeNull();

      const saved = await loadWhatsAppConfigFile();
      expect(saved?.phoneNumber).toBe("+1234567890");
      expect(saved?.pairingCode).toBe(result.pairingCode);
    });
  });

  test("saves phone number and profile", async () => {
    await useTempWhatsAppHome(async () => {
      const result = await saveWhatsAppConfig({
        phoneNumber: "+1234567890",
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
      const dir = path.join(tempHome, ".tinyclaw", "whatsapp");
      const lines = [
        "# TinyClaw WhatsApp bridge",
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

  test("throws if phone number is missing on first save", async () => {
    await useTempWhatsAppHome(async () => {
      expect(saveWhatsAppConfig({})).rejects.toThrow("Phone number is required.");
    });
  });
});

describe("resolveWhatsAppConfigFromSources", () => {
  test("returns null when no phone number is available", () => {
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
      },
    });

    expect(resolved).toEqual({
      phoneNumber: "+1234567890",
      profileId: "profile_from_file",
      pairingCode: null,
      pairedJid: null,
    });
  });

  test("uses file config when env is absent", () => {
    const resolved = resolveWhatsAppConfigFromSources({
      env: {},
      file: {
        phoneNumber: "+9876543210",
        profileId: "profile_from_file",
        pairingCode: "ABCD1234",
        pairedJid: "9876543210@s.whatsapp.net",
      },
    });

    expect(resolved?.phoneNumber).toBe("+9876543210");
    expect(resolved?.pairedJid).toBe("9876543210@s.whatsapp.net");
  });
});