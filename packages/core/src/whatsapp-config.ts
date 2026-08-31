import { randomBytes } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  generateHandshakeCode,
  normalizeHandshakeInput,
} from "./channel-config-shared";
import {
  parseIni,
  pathExists,
  readTextOrNull,
  removeFile,
  writeTextFile,
} from "./fs";
import { getUserConfigDir } from "./user-config";
import { parseAllowedWhatsAppPhones } from "./whatsapp-phones";

export { parseAllowedWhatsAppPhones } from "./whatsapp-phones";

/** WhatsApp name for shared handshake helpers. */
export const generatePairingCode = generateHandshakeCode;
export const normalizePairingCode = normalizeHandshakeInput;

export const DEFAULT_WHATSAPP_PROFILE_ID = "default";
export interface WhatsAppConfigFile {
  allowedPhones: string[];
  outboundPort?: string | null;
  outboundToken?: string | null;
  pairedJid: string | null;
  pairedLid: string | null;
  pairingCode: string | null;
  phoneNumber: string;
  profileId: string;
}

export interface WhatsAppSettingsPublic {
  allowedPhones: string[];
  configured: boolean;
  pairedJid: string | null;
  pairingCode: string | null;
  phoneNumberMasked: string | null;
  profileId: string;
}

export interface UpdateWhatsAppSettingsInput {
  allowedPhones?: string;
  phoneNumber?: string;
  profileId?: string;
}

export function getWhatsAppConfigDir(): string {
  return join(getUserConfigDir(), "whatsapp");
}

export function getWhatsAppConfigPath(): string {
  return join(getWhatsAppConfigDir(), "config.ini");
}

export function maskPhoneNumber(phoneNumber: string): string | null {
  const trimmed = phoneNumber.trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed.length <= 4) {
    return `+${"•".repeat(trimmed.length)}`;
  }

  return `+${"•".repeat(Math.min(trimmed.length - 2, 10))}${trimmed.slice(-2)}`;
}

function phoneDigits(phone: string): string {
  return phone.replace(/\D/g, "");
}

function phoneToWhatsAppJid(phone: string): string {
  return `${phoneDigits(phone)}@s.whatsapp.net`;
}

export function whatsAppUserDigits(jid: string): string {
  return phoneDigits(jid.split("@")[0]?.split(":")[0] ?? "");
}

function maskPhoneNumberFromJid(jid: string | null): string | null {
  if (!jid) {
    return null;
  }

  const digits = whatsAppUserDigits(jid);
  return digits ? maskPhoneNumber(digits) : null;
}

function whatsAppJidServer(jid: string): string {
  return jid.split("@")[1]?.trim() ?? "";
}

function normalizeWhatsAppUserJid(jid: string): string {
  const server = whatsAppJidServer(jid);

  if (server !== "s.whatsapp.net") {
    return jid.trim();
  }

  return `${jid.split("@")[0]?.split(":")[0] ?? ""}@${server}`;
}

function isSameWhatsAppUserJid(left: string, right: string): boolean {
  if (!(left && right)) {
    return false;
  }

  if (normalizeWhatsAppUserJid(left) === normalizeWhatsAppUserJid(right)) {
    return true;
  }

  if (
    whatsAppJidServer(left) !== "s.whatsapp.net" ||
    whatsAppJidServer(right) !== "s.whatsapp.net"
  ) {
    return false;
  }

  const leftDigits = whatsAppUserDigits(left);
  const rightDigits = whatsAppUserDigits(right);
  return Boolean(leftDigits && leftDigits === rightDigits);
}

export function isWhatsAppUserAuthorized(
  jid: string | readonly string[],
  config: Pick<WhatsAppConfigFile, "pairedJid" | "pairedLid"> & {
    allowedPhones?: string[];
  }
): boolean {
  const jids = typeof jid === "string" ? [jid] : jid;
  const allowedPhones = config.allowedPhones ?? [];

  return jids.some((entry) => {
    if (!entry) {
      return false;
    }

    if (
      config.pairedJid &&
      (isSameWhatsAppUserJid(entry, config.pairedJid) ||
        (config.pairedLid
          ? isSameWhatsAppUserJid(entry, config.pairedLid)
          : false))
    ) {
      return true;
    }

    const digits = whatsAppUserDigits(entry);
    return Boolean(digits && allowedPhones.includes(digits));
  });
}

export async function rememberWhatsAppPairedIdentities(
  jids: readonly string[]
): Promise<void> {
  const config = await loadWhatsAppConfigFile();

  if (
    !(
      config &&
      isWhatsAppUserAuthorized(jids, {
        allowedPhones: [],
        pairedJid: config.pairedJid,
        pairedLid: config.pairedLid,
      })
    )
  ) {
    return;
  }

  const phoneJid = jids.find(
    (jid) => whatsAppJidServer(jid) === "s.whatsapp.net"
  );
  const lidJid = jids.find((jid) => whatsAppJidServer(jid) === "lid");
  const nextPairedJid =
    phoneJid &&
    config.pairedJid &&
    isSameWhatsAppUserJid(phoneJid, config.pairedJid)
      ? phoneJid
      : config.pairedJid;
  const nextPairedLid = lidJid ?? config.pairedLid;

  if (
    nextPairedJid === config.pairedJid &&
    nextPairedLid === config.pairedLid
  ) {
    return;
  }

  await writeWhatsAppConfigFile({
    ...config,
    pairedJid: nextPairedJid,
    pairedLid: nextPairedLid,
  });
}

export async function loadWhatsAppConfigFile(): Promise<WhatsAppConfigFile | null> {
  const raw = await readTextOrNull(getWhatsAppConfigPath());

  if (raw === null) {
    return null;
  }

  const values = parseIni(raw);
  const phoneNumber = values.phone_number?.trim() ?? "";
  const profileId = values.profile_id?.trim() || DEFAULT_WHATSAPP_PROFILE_ID;
  const pairingCode = values.pairing_code?.trim() || null;
  const pairedJid = values.paired_jid?.trim() || null;
  const pairedLid = values.paired_lid?.trim() || null;
  const outboundPort = values.outbound_port?.trim() || null;
  const outboundToken = values.outbound_token?.trim() || null;

  return {
    allowedPhones: parseAllowedWhatsAppPhones(values.allowed_phones ?? ""),
    outboundPort,
    outboundToken,
    pairedJid,
    pairedLid,
    pairingCode,
    phoneNumber,
    profileId,
  };
}

/**
 * Shared secret for the loopback outbound server, minted on first use and kept
 * in the 0600 config file, so a process running as another user cannot post to
 * 127.0.0.1/send and make the bot message the paired owner.
 */
export async function ensureWhatsAppOutboundToken(): Promise<string | null> {
  const config = await loadWhatsAppConfigFile();

  if (!config) {
    return null;
  }

  if (config.outboundToken) {
    return config.outboundToken;
  }

  const outboundToken = randomBytes(32).toString("hex");
  await writeWhatsAppConfigFile({ ...config, outboundToken });

  return outboundToken;
}

export function toWhatsAppSettingsPublic(
  file: WhatsAppConfigFile | null
): WhatsAppSettingsPublic {
  if (!file) {
    return {
      allowedPhones: [],
      configured: false,
      pairedJid: null,
      pairingCode: null,
      phoneNumberMasked: null,
      profileId: DEFAULT_WHATSAPP_PROFILE_ID,
    };
  }

  return {
    allowedPhones: file.allowedPhones,
    configured: true,
    pairedJid: file.pairedJid,
    pairingCode: file.pairingCode,
    phoneNumberMasked:
      maskPhoneNumber(file.phoneNumber) ??
      maskPhoneNumberFromJid(file.pairedJid),
    profileId: file.profileId,
  };
}

export async function loadWhatsAppSettingsPublic(): Promise<WhatsAppSettingsPublic> {
  return toWhatsAppSettingsPublic(await loadWhatsAppConfigFile());
}

async function writeWhatsAppConfigFile(
  config: WhatsAppConfigFile
): Promise<void> {
  const lines = [
    "# Nakama WhatsApp bridge",
    `profile_id=${config.profileId}`,
    ...(config.phoneNumber.trim()
      ? [`phone_number=${config.phoneNumber}`]
      : []),
    ...(config.pairingCode ? [`pairing_code=${config.pairingCode}`] : []),
    ...(config.pairedJid ? [`paired_jid=${config.pairedJid}`] : []),
    ...(config.pairedLid ? [`paired_lid=${config.pairedLid}`] : []),
    ...(config.allowedPhones.length > 0
      ? [`allowed_phones=${config.allowedPhones.join(",")}`]
      : []),
    ...(config.outboundPort ? [`outbound_port=${config.outboundPort}`] : []),
    ...(config.outboundToken ? [`outbound_token=${config.outboundToken}`] : []),
    "",
  ];

  await writeTextFile(getWhatsAppConfigPath(), lines.join("\n"), {
    ensureDir: getWhatsAppConfigDir(),
  });
}

function resolvePhoneNumber(
  input: UpdateWhatsAppSettingsInput,
  existing: WhatsAppConfigFile | null
): string {
  return input.phoneNumber === undefined
    ? (existing?.phoneNumber ?? "")
    : input.phoneNumber.trim();
}

function resolveProfileId(
  input: UpdateWhatsAppSettingsInput,
  existing: WhatsAppConfigFile | null
): string {
  return (
    input.profileId?.trim() ||
    existing?.profileId ||
    DEFAULT_WHATSAPP_PROFILE_ID
  );
}

function resolvePairingCode(
  existing: WhatsAppConfigFile | null,
  pairedJid: string | null
): string | null {
  if (pairedJid) {
    return null;
  }

  return existing?.pairingCode ?? null;
}

function buildSavedWhatsAppConfig(
  input: UpdateWhatsAppSettingsInput,
  existing: WhatsAppConfigFile | null
): WhatsAppConfigFile {
  const phoneNumber = resolvePhoneNumber(input, existing);
  const pairedJid = existing?.pairedJid ?? null;

  return {
    allowedPhones: resolveAllowedPhones(input, existing),
    pairedJid,
    pairedLid: existing?.pairedLid ?? null,
    pairingCode: resolvePairingCode(existing, pairedJid),
    phoneNumber,
    profileId: resolveProfileId(input, existing),
  };
}

function resolveAllowedPhones(
  input: UpdateWhatsAppSettingsInput,
  existing: WhatsAppConfigFile | null
): string[] {
  return input.allowedPhones === undefined
    ? (existing?.allowedPhones ?? [])
    : parseAllowedWhatsAppPhones(input.allowedPhones);
}

export async function saveWhatsAppConfig(
  input: UpdateWhatsAppSettingsInput
): Promise<WhatsAppSettingsPublic> {
  const existing = await loadWhatsAppConfigFile();
  const next = buildSavedWhatsAppConfig(input, existing);
  await writeWhatsAppConfigFile(next);
  return toWhatsAppSettingsPublic(next);
}

function getWhatsAppAuthDir(): string {
  return join(getWhatsAppConfigDir(), "auth");
}

// ponytail: filename mirrors whatsapp-worker.ts QR_CODE_FILENAME
function getWhatsAppQrCodePath(): string {
  return join(getWhatsAppConfigDir(), "worker-qr.txt");
}

export async function resetWhatsAppSessionForReconnect(): Promise<WhatsAppSettingsPublic> {
  const existing = await loadWhatsAppConfigFile();

  if (!existing) {
    throw new Error("Enable WhatsApp in Integrations before reconnecting.");
  }

  if (await pathExists(getWhatsAppAuthDir())) {
    await rm(getWhatsAppAuthDir(), { force: true, recursive: true });
  }

  const qrPath = getWhatsAppQrCodePath();
  if (await pathExists(qrPath)) {
    await removeFile(qrPath);
  }

  const next: WhatsAppConfigFile = {
    ...existing,
    pairedJid: null,
    pairedLid: null,
    pairingCode: null,
  };

  await writeWhatsAppConfigFile(next);
  return toWhatsAppSettingsPublic(next);
}

export async function regenerateWhatsAppPairingCode(): Promise<WhatsAppSettingsPublic> {
  const existing = await loadWhatsAppConfigFile();

  if (!existing) {
    throw new Error(
      "Enable WhatsApp in Integrations before generating a pairing code."
    );
  }

  const next: WhatsAppConfigFile = {
    ...existing,
    pairingCode: generatePairingCode(),
  };

  await writeWhatsAppConfigFile(next);
  return toWhatsAppSettingsPublic(next);
}

export async function verifyAndPairWhatsAppUser(
  pairingCodeInput: string,
  jid: string
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const config = await loadWhatsAppConfigFile();

  if (!config) {
    return {
      message: "WhatsApp is not configured on the server yet.",
      ok: false,
    };
  }

  if (isWhatsAppUserAuthorized(jid, config)) {
    return { message: "This number is already linked.", ok: true };
  }

  const expected = config.pairingCode;

  if (!expected) {
    return {
      message:
        "No pairing code is active. Open Nakama Integrations \u2192 WhatsApp and generate a new code.",
      ok: false,
    };
  }

  if (
    normalizePairingCode(pairingCodeInput) !== normalizePairingCode(expected)
  ) {
    return {
      message:
        "Invalid pairing code. Copy it from Integrations \u2192 WhatsApp and try again.",
      ok: false,
    };
  }

  const isLid = jid.endsWith("@lid");
  const phoneFromJid = isLid ? "" : whatsAppUserDigits(jid);
  const pairedLid = isLid ? jid : config.pairedLid;
  const pairedJid = isLid
    ? (config.pairedJid ??
      (config.phoneNumber ? phoneToWhatsAppJid(config.phoneNumber) : null))
    : jid;

  await writeWhatsAppConfigFile({
    ...config,
    pairedJid,
    pairedLid,
    pairingCode: null,
    phoneNumber: phoneFromJid || config.phoneNumber,
  });

  return {
    message: "Linked successfully. You can chat with Nakama now.",
    ok: true,
  };
}

/** After QR link, pair the owner and store their LID for inbound routing. */
export async function syncWhatsAppOwnerPairing(options: {
  ownerJid: string;
  ownerLid?: string | null;
}): Promise<void> {
  const config = await loadWhatsAppConfigFile();

  if (!config) {
    return;
  }

  const isPhoneJid = whatsAppJidServer(options.ownerJid) === "s.whatsapp.net";
  const ownerPhone = isPhoneJid ? whatsAppUserDigits(options.ownerJid) : "";
  const ownerLid = options.ownerLid?.trim() || null;
  const next: WhatsAppConfigFile = {
    ...config,
    pairedJid: config.pairedJid ?? options.ownerJid,
    // Preserve an existing chat LID. `me.lid` can be a device/account LID, which
    // does not always match the private self-chat JID used for inbound messages.
    pairedLid: config.pairedLid ?? ownerLid,
    pairingCode: null,
    phoneNumber: ownerPhone || config.phoneNumber,
  };

  if (
    next.pairedJid === config.pairedJid &&
    next.pairedLid === config.pairedLid &&
    next.pairingCode === config.pairingCode
  ) {
    return;
  }

  await writeWhatsAppConfigFile(next);
}

export function resolveWhatsAppConfigFromSources(options: {
  env?: Record<string, string | undefined>;
  file?: WhatsAppConfigFile | null;
}): WhatsAppConfigFile | null {
  const env = options.env ?? process.env;
  const file = options.file ?? null;

  if (!(file || env.WHATSAPP_PHONE_NUMBER?.trim())) {
    return null;
  }

  return {
    allowedPhones: file?.allowedPhones ?? [],
    pairedJid: file?.pairedJid ?? null,
    pairedLid: file?.pairedLid ?? null,
    pairingCode: file?.pairingCode ?? null,
    phoneNumber:
      env.WHATSAPP_PHONE_NUMBER?.trim() || file?.phoneNumber?.trim() || "",
    profileId:
      env.NAKAMA_WHATSAPP_PROFILE_ID?.trim() ||
      file?.profileId?.trim() ||
      DEFAULT_WHATSAPP_PROFILE_ID,
  };
}
