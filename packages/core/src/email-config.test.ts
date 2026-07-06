import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createProviderInstanceId,
  getUserConfigPath,
  parseIniWithSections,
  saveUserConfig,
} from "./user-config";
import {
  EMAIL_SECTION,
  REDACTED_SECRET_VALUE,
  loadEmailConfig,
  loadEmailSettingsPublic,
  resolveFromAddress,
  resolveFromHeader,
  saveEmailConfig,
  toEmailSettingsPublic,
} from "./email-config";
import { readTextOrNull } from "./fs";

describe("email config", () => {
  let configDir = "";

  afterEach(async () => {
    if (configDir) {
      await rm(configDir, { recursive: true, force: true });
      configDir = "";
    }

    delete process.env.NAKAMA_CONFIG_DIR;
  });

  test("formats from header with optional display name", () => {
    expect(
      resolveFromHeader({
        username: "user@example.com",
        from: "user@example.com",
        fromName: "",
      }),
    ).toBe("user@example.com");

    expect(
      resolveFromHeader({
        username: "user@example.com",
        from: "user@example.com",
        fromName: "Acme Support",
      }),
    ).toBe('"Acme Support" <user@example.com>');
  });

  test("round-trips email settings without exposing password publicly", async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-email-config-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;

    const saved = await saveEmailConfig({
      imapHost: "imap.example.com",
      imapPort: 993,
      imapSecure: true,
      smtpHost: "smtp.example.com",
      smtpPort: 587,
      smtpSecure: false,
      username: "user@example.com",
      password: "super-secret-password",
      from: "user@example.com",
      fromName: "Support Team",
    });

    expect(saved.fromName).toBe("Support Team");

    const loaded = await loadEmailConfig();
    expect(saved.configured).toBe(true);
    expect(saved.passwordMasked).not.toBe("super-secret-password");
    expect(saved.passwordMasked).toContain("word");
    expect(loaded?.fromName).toBe("Support Team");
    expect(loaded?.password).toBe("super-secret-password");

    const publicSettings = await loadEmailSettingsPublic();
    expect(publicSettings.configured).toBe(true);
    expect("password" in publicSettings).toBe(false);
  });

  test("keeps existing password when update omits it", async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-email-config-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;

    await saveEmailConfig({
      imapHost: "imap.example.com",
      smtpHost: "smtp.example.com",
      username: "user@example.com",
      password: "keep-me",
      from: "user@example.com",
    });

    await saveEmailConfig({
      smtpHost: "smtp2.example.com",
    });

    const loaded = await loadEmailConfig();
    expect(loaded?.password).toBe("keep-me");
    expect(loaded?.smtpHost).toBe("smtp2.example.com");
  });

  test("keeps existing password when update sends redacted placeholder", async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-email-config-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;

    await saveEmailConfig({
      imapHost: "imap.example.com",
      smtpHost: "smtp.example.com",
      username: "user@example.com",
      password: "keep-me-too",
      from: "user@example.com",
    });

    await saveEmailConfig({
      password: REDACTED_SECRET_VALUE,
      username: "other@example.com",
    });

    const loaded = await loadEmailConfig();
    expect(loaded?.password).toBe("keep-me-too");
    expect(loaded?.username).toBe("other@example.com");
  });

  test("reports configured false when required fields are missing", () => {
    expect(
      toEmailSettingsPublic({
        imapHost: "imap.example.com",
        imapPort: 993,
        imapSecure: true,
        smtpHost: "",
        smtpPort: 587,
        smtpSecure: false,
        username: "user@example.com",
        password: "secret",
        from: "user@example.com",
        fromName: "",
      }).configured,
    ).toBe(false);
  });

  test("saveUserConfig preserves email section", async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-email-config-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;

    await saveEmailConfig({
      imapHost: "imap.example.com",
      smtpHost: "smtp.example.com",
      username: "user@example.com",
      password: "secret",
      from: "user@example.com",
    });

    const providerId = createProviderInstanceId();
    await saveUserConfig({
      defaultProviderId: providerId,
      providers: [
        {
          id: providerId,
          type: "openai",
          label: "OpenAI",
          apiKey: "sk-test",
          createdAt: "2026-06-21T00:00:00.000Z",
        },
      ],
    });

    const raw = await readTextOrNull(getUserConfigPath());
    expect(raw).toContain(`[${EMAIL_SECTION}]`);
    expect(raw).toContain("imap_host=imap.example.com");

    const parsed = parseIniWithSections(raw ?? "");
    expect(parsed.sections[EMAIL_SECTION]?.password).toBe("secret");
  });
});
