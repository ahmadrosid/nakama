import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { withTempHomedir } from "./testing/channel-config-fixtures";
import {
  isWhatsAppUserAuthorized,
  loadWhatsAppConfigFile,
  maskPhoneNumber,
  parseAllowedWhatsAppPhones,
  resetWhatsAppSessionForReconnect,
  resolveWhatsAppConfigFromSources,
  saveWhatsAppConfig,
  syncWhatsAppOwnerPairing,
} from "./whatsapp-config";
import {
  createWhatsAppWorkerHeartbeat,
  getWhatsAppWorkerStatus,
} from "./whatsapp-worker";

describe("organization isolation", () => {
  test("isolates settings and reconnects between organizations", async () => {
    await withTempHomedir("nakama-wa-orgs-", async () => {
      await saveWhatsAppConfig({ profileId: "well-test" }, "org_a");
      await saveWhatsAppConfig({ profileId: "finance" }, "org_b");
      await syncWhatsAppOwnerPairing(
        { ownerJid: "628111111111@s.whatsapp.net" },
        "org_a"
      );
      await syncWhatsAppOwnerPairing(
        { ownerJid: "628222222222@s.whatsapp.net" },
        "org_b"
      );
      expect((await loadWhatsAppConfigFile("org_a"))?.profileId).toBe(
        "well-test"
      );
      expect((await loadWhatsAppConfigFile("org_b"))?.profileId).toBe(
        "finance"
      );
      expect(await loadWhatsAppConfigFile()).toBeNull();
      expect(await loadWhatsAppConfigFile("org_c")).toBeNull();
      await resetWhatsAppSessionForReconnect("org_a");
      expect((await loadWhatsAppConfigFile("org_a"))?.pairedJid).toBeNull();
      expect((await loadWhatsAppConfigFile("org_b"))?.pairedJid).toBe(
        "628222222222@s.whatsapp.net"
      );
    });
  });
});

describe("getWhatsAppWorkerStatus", () => {
  test("reports a rejected link only while the worker runs", async () => {
    await withTempHomedir("nakama-wa-link-error-", async () => {
      await saveWhatsAppConfig({ profileId: "finance" }, "org_a");
      const heartbeat = createWhatsAppWorkerHeartbeat("org_a");

      await heartbeat.write({
        connected: false,
        linkError: "in use",
        pid: process.pid,
        updatedAt: new Date().toISOString(),
      });
      expect((await getWhatsAppWorkerStatus("org_a")).linkError).toBe("in use");

      await heartbeat.write({
        connected: false,
        linkError: "in use",
        pid: process.pid,
        updatedAt: new Date(0).toISOString(),
      });
      expect(
        (await getWhatsAppWorkerStatus("org_a")).linkError
      ).toBeUndefined();
    });
  });
});

describe("maskPhoneNumber", () => {
  test("returns null for empty", () => {
    expect(maskPhoneNumber("")).toBeNull();
  });

  test("masks short numbers", () => {
    expect(maskPhoneNumber("1234")).toBe("+••••");
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

describe("saveWhatsAppConfig", () => {
  test("creates config with a fresh expiring pairing code", async () => {
    await withTempHomedir("nakama-core-wa-home-", async () => {
      const result = await saveWhatsAppConfig({ profileId: "profile_custom" });

      expect(result.pairingCode).toMatch(/^[0-9A-F]{32}$/);
      expect(result.configured).toBe(true);
      expect(result.phoneNumberMasked).toBeNull();
      expect(result.pairedJid).toBeNull();

      const saved = await loadWhatsAppConfigFile();
      expect(saved?.phoneNumber).toBe("");
      expect(saved?.profileId).toBe("profile_custom");
      expect(Date.parse(saved?.pairingCodeExpiresAt ?? "")).toBeGreaterThan(
        Date.now()
      );
    });
  });

  test("keeps a live pairing code across an unrelated save", async () => {
    await withTempHomedir("nakama-core-wa-home-", async () => {
      const first = await saveWhatsAppConfig({ profileId: "profile_custom" });
      const result = await saveWhatsAppConfig({ profileId: "profile_custom" });

      expect(result.pairingCode).toBe(first.pairingCode);
    });
  });

  test("preserves pairedJid when updating other fields", async () => {
    await withTempHomedir("nakama-core-wa-home-", async (tempHome) => {
      await saveWhatsAppConfig({ phoneNumber: "+1234567890" });
      const first = await loadWhatsAppConfigFile();

      const configWithJid = {
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

  test("keeps names and add times for allowed phones", async () => {
    await withTempHomedir("nakama-core-wa-home-", async () => {
      const first = await saveWhatsAppConfig({
        allowedPhones: "628111111111",
        profileId: "default",
      });

      const firstAddedAt = first.allowedPhoneDetails["628111111111"]?.addedAt;

      const added = await saveWhatsAppConfig({
        allowedPhoneNames: { "+62 822-222-2222": "Sari, Ops = lead" },
        allowedPhones: "628111111111,628222222222",
      });

      const addedAt = added.allowedPhoneDetails["628222222222"]?.addedAt;
      expect(added.allowedPhoneDetails["628222222222"]?.name).toBe(
        "Sari, Ops = lead"
      );
      expect(addedAt).toEqual(expect.any(String));

      const renamed = await saveWhatsAppConfig({
        allowedPhoneNames: { "628111111111": "Budi" },
      });

      expect(renamed.allowedPhoneDetails).toEqual({
        "628111111111": { addedAt: firstAddedAt ?? null, name: "Budi" },
        "628222222222": { addedAt: addedAt ?? null, name: "Sari, Ops = lead" },
      });

      await saveWhatsAppConfig({ allowedPhones: "628222222222" });
      const saved = await loadWhatsAppConfigFile();
      expect(saved?.allowedPhones).toEqual(["628222222222"]);
      expect(Object.keys(saved?.allowedPhoneDetails ?? {})).toEqual([
        "628222222222",
      ]);
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

  test("keeps group access open for a config saved before the setting existed", async () => {
    await withTempHomedir("nakama-core-wa-home-", async (homeDir) => {
      const dir = path.join(homeDir, ".nakama", "whatsapp");
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, "config.ini"),
        "phone_number=1234567890\nrequire_group_mention=false\n"
      );
      expect((await loadWhatsAppConfigFile())?.allowUnpairedGroupMembers).toBe(
        true
      );

      const mentionOn = await saveWhatsAppConfig({ requireGroupMention: true });
      expect(mentionOn.allowUnpairedGroupMembers).toBe(true);
    });
  });

  test("saves allowUnpairedGroupMembers apart from requireGroupMention", async () => {
    await withTempHomedir("nakama-core-wa-home-", async () => {
      const created = await saveWhatsAppConfig({ profileId: "default" });
      expect(created.allowUnpairedGroupMembers).toBe(false);

      await saveWhatsAppConfig({ allowUnpairedGroupMembers: true });
      expect((await loadWhatsAppConfigFile())?.allowUnpairedGroupMembers).toBe(
        true
      );

      await saveWhatsAppConfig({
        allowUnpairedGroupMembers: false,
        requireGroupMention: false,
      });
      const saved = await loadWhatsAppConfigFile();
      expect(saved?.allowUnpairedGroupMembers).toBe(false);
      expect(saved?.requireGroupMention).toBe(false);
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

      const configWithJid = {
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
      await expect(resetWhatsAppSessionForReconnect()).rejects.toThrow(
        "Enable WhatsApp in this agent’s Connections before reconnecting."
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
        allowUnpairedGroupMembers: false,
        pairedJid: null,
        pairedLid: null,
        pairingCode: null,
        pairingCodeExpiresAt: null,
        phoneNumber: "+9876543210",
        profileId: "profile_from_file",
        requireGroupMention: true,
      },
    });

    expect(resolved).toEqual({
      allowedPhones: [],
      allowUnpairedGroupMembers: false,
      pairedJid: null,
      pairedLid: null,
      pairingCode: null,
      pairingCodeExpiresAt: null,
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
        allowUnpairedGroupMembers: true,
        pairedJid: "9876543210@s.whatsapp.net",
        pairedLid: null,
        pairingCode: "ABCD1234",
        pairingCodeExpiresAt: null,
        phoneNumber: "",
        profileId: "profile_from_file",
        requireGroupMention: false,
      },
    });

    expect(resolved?.phoneNumber).toBe("");
    expect(resolved?.pairedJid).toBe("9876543210@s.whatsapp.net");
    expect(resolved?.requireGroupMention).toBe(false);
    expect(resolved?.allowUnpairedGroupMembers).toBe(true);
  });
});
