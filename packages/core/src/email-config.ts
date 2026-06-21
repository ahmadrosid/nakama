import { readTextOrNull } from "./fs";
import {
  getUserConfigPath,
  parseIniWithSections,
  writeParsedConfigIni,
} from "./user-config";

export const EMAIL_SECTION = "email";
export const REDACTED_SECRET_VALUE = "••••••••";

export const DEFAULT_IMAP_PORT = 993;
export const DEFAULT_SMTP_PORT = 587;

export interface EmailConfigFile {
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  username: string;
  password: string;
  from: string;
}

export interface EmailSettingsPublic {
  configured: boolean;
  imapHost: string | null;
  imapPort: number | null;
  imapSecure: boolean | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean | null;
  username: string | null;
  from: string | null;
  passwordMasked: string | null;
}

export interface UpdateEmailSettingsInput {
  imapHost?: string;
  imapPort?: number;
  imapSecure?: boolean;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  username?: string;
  password?: string;
  from?: string;
}

export function maskSecret(secret: string): string | null {
  const trimmed = secret.trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed.length <= 8) {
    return REDACTED_SECRET_VALUE;
  }

  return `${"•".repeat(Math.min(trimmed.length - 4, 12))}${trimmed.slice(-4)}`;
}

export function parseIniBoolean(value: string | undefined, fallback: boolean): boolean {
  const trimmed = value?.trim().toLowerCase();

  if (!trimmed) {
    return fallback;
  }

  if (trimmed === "true" || trimmed === "1" || trimmed === "yes" || trimmed === "on") {
    return true;
  }

  if (trimmed === "false" || trimmed === "0" || trimmed === "no" || trimmed === "off") {
    return false;
  }

  return fallback;
}

export function parseIniPort(value: string | undefined, fallback: number): number {
  const trimmed = value?.trim();

  if (!trimmed) {
    return fallback;
  }

  const port = Number(trimmed);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }

  return port;
}

export function validateEmailPort(port: number): number {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${port}`);
  }

  return port;
}

export function resolveFromAddress(config: Pick<EmailConfigFile, "from" | "username">): string {
  return config.from.trim() || config.username.trim();
}

export function isEmailConfigComplete(config: EmailConfigFile | null): boolean {
  if (!config) {
    return false;
  }

  return Boolean(
    config.imapHost.trim() &&
      config.smtpHost.trim() &&
      config.username.trim() &&
      config.password.trim() &&
      resolveFromAddress(config),
  );
}

function parseEmailSection(values: Record<string, string>): EmailConfigFile | null {
  const username = values.username?.trim() ?? "";
  const password = values.password?.trim() ?? "";
  const imapHost = values.imap_host?.trim() ?? "";
  const smtpHost = values.smtp_host?.trim() ?? "";

  if (!username && !password && !imapHost && !smtpHost) {
    return null;
  }

  return {
    imapHost,
    imapPort: parseIniPort(values.imap_port, DEFAULT_IMAP_PORT),
    imapSecure: parseIniBoolean(values.imap_secure, true),
    smtpHost,
    smtpPort: parseIniPort(values.smtp_port, DEFAULT_SMTP_PORT),
    smtpSecure: parseIniBoolean(values.smtp_secure, false),
    username,
    password,
    from: values.from?.trim() ?? "",
  };
}

function buildEmailSectionValues(config: EmailConfigFile): Record<string, string> {
  return {
    imap_host: config.imapHost,
    imap_port: String(config.imapPort),
    imap_secure: config.imapSecure ? "true" : "false",
    smtp_host: config.smtpHost,
    smtp_port: String(config.smtpPort),
    smtp_secure: config.smtpSecure ? "true" : "false",
    username: config.username,
    password: config.password,
    from: resolveFromAddress(config),
  };
}

export async function loadEmailConfig(): Promise<EmailConfigFile | null> {
  const raw = await readTextOrNull(getUserConfigPath());

  if (raw === null) {
    return null;
  }

  const parsed = parseIniWithSections(raw);
  const section = parsed.sections[EMAIL_SECTION];

  if (!section) {
    return null;
  }

  return parseEmailSection(section);
}

export function toEmailSettingsPublic(file: EmailConfigFile | null): EmailSettingsPublic {
  if (!file) {
    return {
      configured: false,
      imapHost: null,
      imapPort: null,
      imapSecure: null,
      smtpHost: null,
      smtpPort: null,
      smtpSecure: null,
      username: null,
      from: null,
      passwordMasked: null,
    };
  }

  return {
    configured: isEmailConfigComplete(file),
    imapHost: file.imapHost || null,
    imapPort: file.imapPort,
    imapSecure: file.imapSecure,
    smtpHost: file.smtpHost || null,
    smtpPort: file.smtpPort,
    smtpSecure: file.smtpSecure,
    username: file.username || null,
    from: resolveFromAddress(file) || null,
    passwordMasked: maskSecret(file.password),
  };
}

export async function loadEmailSettingsPublic(): Promise<EmailSettingsPublic> {
  return toEmailSettingsPublic(await loadEmailConfig());
}

export function resolveEmailPassword(
  input: string | undefined,
  existing: EmailConfigFile | null,
): string {
  if (input === undefined) {
    return existing?.password ?? "";
  }

  const trimmed = input.trim();

  if (!trimmed || trimmed === REDACTED_SECRET_VALUE) {
    return existing?.password ?? "";
  }

  return trimmed;
}

function buildSavedEmailConfig(
  input: UpdateEmailSettingsInput,
  existing: EmailConfigFile | null,
): EmailConfigFile {
  const imapHost =
    input.imapHost !== undefined ? input.imapHost.trim() : (existing?.imapHost ?? "");
  const smtpHost =
    input.smtpHost !== undefined ? input.smtpHost.trim() : (existing?.smtpHost ?? "");
  const username =
    input.username !== undefined ? input.username.trim() : (existing?.username ?? "");
  const password = resolveEmailPassword(input.password, existing);
  const from =
    input.from !== undefined ? input.from.trim() : (existing?.from ?? username);

  return {
    imapHost,
    imapPort:
      input.imapPort !== undefined
        ? validateEmailPort(input.imapPort)
        : (existing?.imapPort ?? DEFAULT_IMAP_PORT),
    imapSecure: input.imapSecure ?? existing?.imapSecure ?? true,
    smtpHost,
    smtpPort:
      input.smtpPort !== undefined
        ? validateEmailPort(input.smtpPort)
        : (existing?.smtpPort ?? DEFAULT_SMTP_PORT),
    smtpSecure: input.smtpSecure ?? existing?.smtpSecure ?? false,
    username,
    password,
    from,
  };
}

export async function saveEmailConfig(
  input: UpdateEmailSettingsInput,
): Promise<EmailSettingsPublic> {
  const raw = await readTextOrNull(getUserConfigPath());
  const parsed = raw === null ? { global: {}, sections: {} } : parseIniWithSections(raw);
  const existing = await loadEmailConfig();
  const next = buildSavedEmailConfig(input, existing);

  parsed.sections[EMAIL_SECTION] = buildEmailSectionValues(next);
  await writeParsedConfigIni(parsed.global, parsed.sections);

  return toEmailSettingsPublic(next);
}

export function toMailboxConfig(config: EmailConfigFile) {
  return {
    auth: {
      user: config.username,
      pass: config.password,
    },
    from: resolveFromAddress(config),
    imap: {
      host: config.imapHost,
      port: config.imapPort,
      secure: config.imapSecure,
    },
    smtp: {
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
    },
  };
}

export const emailConfigToMailboxConfig = toMailboxConfig;
