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
  from: string;
  fromName: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  password: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  username: string;
}

export interface EmailSettingsPublic {
  configured: boolean;
  from: string | null;
  fromName: string | null;
  imapHost: string | null;
  imapPort: number | null;
  imapSecure: boolean | null;
  passwordMasked: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean | null;
  username: string | null;
}

export interface UpdateEmailSettingsInput {
  from?: string;
  fromName?: string;
  imapHost?: string;
  imapPort?: number;
  imapSecure?: boolean;
  password?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  username?: string;
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

export function parseIniBoolean(
  value: string | undefined,
  fallback: boolean
): boolean {
  const trimmed = value?.trim().toLowerCase();

  if (!trimmed) {
    return fallback;
  }

  if (
    trimmed === "true" ||
    trimmed === "1" ||
    trimmed === "yes" ||
    trimmed === "on"
  ) {
    return true;
  }

  if (
    trimmed === "false" ||
    trimmed === "0" ||
    trimmed === "no" ||
    trimmed === "off"
  ) {
    return false;
  }

  return fallback;
}

export function parseIniPort(
  value: string | undefined,
  fallback: number
): number {
  const trimmed = value?.trim();

  if (!trimmed) {
    return fallback;
  }

  const port = Number(trimmed);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid port: ${value}`);
  }

  return port;
}

export function validateEmailPort(port: number): number {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid port: ${port}`);
  }

  return port;
}

export function resolveFromAddress(
  config: Pick<EmailConfigFile, "from" | "username">
): string {
  return config.from.trim() || config.username.trim();
}

export function resolveFromHeader(
  config: Pick<EmailConfigFile, "from" | "fromName" | "username">
): string {
  const address = resolveFromAddress(config);
  const name = config.fromName.trim();

  if (!address) {
    return "";
  }

  if (!name) {
    return address;
  }

  const escaped = name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}" <${address}>`;
}

export function isEmailConfigComplete(
  config: EmailConfigFile | null
): config is EmailConfigFile {
  if (!config) {
    return false;
  }

  return Boolean(
    config.imapHost.trim() &&
      config.smtpHost.trim() &&
      config.username.trim() &&
      config.password.trim() &&
      resolveFromAddress(config)
  );
}

function parseEmailSection(
  values: Record<string, string>
): EmailConfigFile | null {
  const username = values.username?.trim() ?? "";
  const password = values.password?.trim() ?? "";
  const imapHost = values.imap_host?.trim() ?? "";
  const smtpHost = values.smtp_host?.trim() ?? "";

  if (!(username || password || imapHost || smtpHost)) {
    return null;
  }

  return {
    from: values.from?.trim() ?? "",
    fromName: values.from_name?.trim() ?? "",
    imapHost,
    imapPort: parseIniPort(values.imap_port, DEFAULT_IMAP_PORT),
    imapSecure: parseIniBoolean(values.imap_secure, true),
    password,
    smtpHost,
    smtpPort: parseIniPort(values.smtp_port, DEFAULT_SMTP_PORT),
    smtpSecure: parseIniBoolean(values.smtp_secure, false),
    username,
  };
}

function buildEmailSectionValues(
  config: EmailConfigFile
): Record<string, string> {
  return {
    from: resolveFromAddress(config),
    from_name: config.fromName,
    imap_host: config.imapHost,
    imap_port: String(config.imapPort),
    imap_secure: config.imapSecure ? "true" : "false",
    password: config.password,
    smtp_host: config.smtpHost,
    smtp_port: String(config.smtpPort),
    smtp_secure: config.smtpSecure ? "true" : "false",
    username: config.username,
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

export function toEmailSettingsPublic(
  file: EmailConfigFile | null
): EmailSettingsPublic {
  if (!file) {
    return {
      configured: false,
      from: null,
      fromName: null,
      imapHost: null,
      imapPort: null,
      imapSecure: null,
      passwordMasked: null,
      smtpHost: null,
      smtpPort: null,
      smtpSecure: null,
      username: null,
    };
  }

  return {
    configured: isEmailConfigComplete(file),
    from: resolveFromAddress(file) || null,
    fromName: file.fromName || null,
    imapHost: file.imapHost || null,
    imapPort: file.imapPort,
    imapSecure: file.imapSecure,
    passwordMasked: maskSecret(file.password),
    smtpHost: file.smtpHost || null,
    smtpPort: file.smtpPort,
    smtpSecure: file.smtpSecure,
    username: file.username || null,
  };
}

export async function loadEmailSettingsPublic(): Promise<EmailSettingsPublic> {
  return toEmailSettingsPublic(await loadEmailConfig());
}

export function resolveEmailPassword(
  input: string | undefined,
  existing: EmailConfigFile | null
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
  existing: EmailConfigFile | null
): EmailConfigFile {
  const imapHost =
    input.imapHost === undefined
      ? (existing?.imapHost ?? "")
      : input.imapHost.trim();
  const smtpHost =
    input.smtpHost === undefined
      ? (existing?.smtpHost ?? "")
      : input.smtpHost.trim();
  const username =
    input.username === undefined
      ? (existing?.username ?? "")
      : input.username.trim();
  const password = resolveEmailPassword(input.password, existing);
  const from =
    input.from === undefined ? (existing?.from ?? username) : input.from.trim();
  const fromName =
    input.fromName === undefined
      ? (existing?.fromName ?? "")
      : input.fromName.trim();

  return {
    from,
    fromName,
    imapHost,
    imapPort:
      input.imapPort === undefined
        ? (existing?.imapPort ?? DEFAULT_IMAP_PORT)
        : validateEmailPort(input.imapPort),
    imapSecure: input.imapSecure ?? existing?.imapSecure ?? true,
    password,
    smtpHost,
    smtpPort:
      input.smtpPort === undefined
        ? (existing?.smtpPort ?? DEFAULT_SMTP_PORT)
        : validateEmailPort(input.smtpPort),
    smtpSecure: input.smtpSecure ?? existing?.smtpSecure ?? false,
    username,
  };
}

export async function saveEmailConfig(
  input: UpdateEmailSettingsInput
): Promise<EmailSettingsPublic> {
  const raw = await readTextOrNull(getUserConfigPath());
  const parsed =
    raw === null ? { global: {}, sections: {} } : parseIniWithSections(raw);
  const existing = await loadEmailConfig();
  const next = buildSavedEmailConfig(input, existing);

  parsed.sections[EMAIL_SECTION] = buildEmailSectionValues(next);
  await writeParsedConfigIni(parsed.global, parsed.sections);

  return toEmailSettingsPublic(next);
}

export function toMailboxConfig(config: EmailConfigFile) {
  return {
    auth: {
      pass: config.password,
      user: config.username,
    },
    from: resolveFromHeader(config),
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
