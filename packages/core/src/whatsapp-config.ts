import { randomBytes } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { parseIni, pathExists, readTextOrNull, removeFile, writePrivateTextFile } from "./fs";
import { getUserConfigDir } from "./user-config";

export const DEFAULT_WHATSAPP_PROFILE_ID = "default";

export interface WhatsAppConfigFile {
  phoneNumber: string;
  profileId: string;
  pairingCode: string | null;
  pairedJid: string | null;
  pairedLid: string | null;
  outboundPort?: string | null;
}

export interface WhatsAppSettingsPublic {
  configured: boolean;
  phoneNumberMasked: string | null;
  pairingCode: string | null;
  pairedJid: string | null;
  profileId: string;
}

export interface UpdateWhatsAppSettingsInput {
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

export function generatePairingCode(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}

export function normalizePairingCode(input: string): string {
  return input.trim().replace(/\s+/g, "").toUpperCase();
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
  if (!left || !right) {
    return false;
  }

  if (normalizeWhatsAppUserJid(left) === normalizeWhatsAppUserJid(right)) {
    return true;
  }

  if (whatsAppJidServer(left) !== "s.whatsapp.net" || whatsAppJidServer(right) !== "s.whatsapp.net") {
    return false;
  }

  const leftDigits = whatsAppUserDigits(left);
  const rightDigits = whatsAppUserDigits(right);
  return Boolean(leftDigits && leftDigits === rightDigits);
}

export function isWhatsAppUserAuthorized(
  jid: string,
  config: Pick<WhatsAppConfigFile, "pairedJid" | "pairedLid">,
): boolean {
  if (!config.pairedJid) {
    return false;
  }

  if (
    isSameWhatsAppUserJid(jid, config.pairedJid) ||
    (config.pairedLid ? isSameWhatsAppUserJid(jid, config.pairedLid) : false)
  ) {
    return true;
  }

  return false;
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

  return {
    phoneNumber,
    profileId,
    pairingCode,
    pairedJid,
    pairedLid,
    outboundPort,
  };
}

export function toWhatsAppSettingsPublic(
  file: WhatsAppConfigFile | null,
): WhatsAppSettingsPublic {
  if (!file) {
    return {
      configured: false,
      phoneNumberMasked: null,
      pairingCode: null,
      pairedJid: null,
      profileId: DEFAULT_WHATSAPP_PROFILE_ID,
    };
  }

  return {
    configured: true,
    phoneNumberMasked:
      maskPhoneNumber(file.phoneNumber) ?? maskPhoneNumberFromJid(file.pairedJid),
    pairingCode: file.pairingCode,
    pairedJid: file.pairedJid,
    profileId: file.profileId,
  };
}

export async function loadWhatsAppSettingsPublic(): Promise<WhatsAppSettingsPublic> {
  return toWhatsAppSettingsPublic(await loadWhatsAppConfigFile());
}

async function writeWhatsAppConfigFile(config: WhatsAppConfigFile): Promise<void> {
  const lines = [
    "# Nakama WhatsApp bridge",
    `profile_id=${config.profileId}`,
    ...(config.phoneNumber.trim() ? [`phone_number=${config.phoneNumber}`] : []),
    ...(config.pairingCode ? [`pairing_code=${config.pairingCode}`] : []),
    ...(config.pairedJid ? [`paired_jid=${config.pairedJid}`] : []),
    ...(config.pairedLid ? [`paired_lid=${config.pairedLid}`] : []),
    "",
  ];

  await writePrivateTextFile(getWhatsAppConfigPath(), lines.join("\n"), {
    ensureDir: getWhatsAppConfigDir(),
  });
}

function resolvePhoneNumber(
  input: UpdateWhatsAppSettingsInput,
  existing: WhatsAppConfigFile | null,
): string {
  return input.phoneNumber !== undefined
    ? input.phoneNumber.trim()
    : (existing?.phoneNumber ?? "");
}

function resolveProfileId(
  input: UpdateWhatsAppSettingsInput,
  existing: WhatsAppConfigFile | null,
): string {
  return input.profileId?.trim() || existing?.profileId || DEFAULT_WHATSAPP_PROFILE_ID;
}

function resolvePairingCode(
  existing: WhatsAppConfigFile | null,
  pairedJid: string | null,
): string | null {
  if (pairedJid) {
    return null;
  }

  return existing?.pairingCode ?? null;
}

function buildSavedWhatsAppConfig(
  input: UpdateWhatsAppSettingsInput,
  existing: WhatsAppConfigFile | null,
): WhatsAppConfigFile {
  const phoneNumber = resolvePhoneNumber(input, existing);
  const pairedJid = existing?.pairedJid ?? null;

  return {
    phoneNumber,
    profileId: resolveProfileId(input, existing),
    pairingCode: resolvePairingCode(existing, pairedJid),
    pairedJid,
    pairedLid: existing?.pairedLid ?? null,
  };
}

export async function saveWhatsAppConfig(
  input: UpdateWhatsAppSettingsInput,
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
    await rm(getWhatsAppAuthDir(), { recursive: true, force: true });
  }

  const qrPath = getWhatsAppQrCodePath();
  if (await pathExists(qrPath)) {
    await removeFile(qrPath);
  }

  const next: WhatsAppConfigFile = {
    ...existing,
    pairingCode: null,
    pairedJid: null,
    pairedLid: null,
  };

  await writeWhatsAppConfigFile(next);
  return toWhatsAppSettingsPublic(next);
}

export async function regenerateWhatsAppPairingCode(): Promise<WhatsAppSettingsPublic> {
  const existing = await loadWhatsAppConfigFile();

  if (!existing) {
    throw new Error("Enable WhatsApp in Integrations before generating a pairing code.");
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
  jid: string,
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const config = await loadWhatsAppConfigFile();

  if (!config) {
    return { ok: false, message: "WhatsApp is not configured on the server yet." };
  }

  if (isWhatsAppUserAuthorized(jid, config)) {
    return { ok: true, message: "This number is already linked." };
  }

  const expected = config.pairingCode;

  if (!expected) {
    return {
      ok: false,
      message:
        "No pairing code is active. Open Nakama Integrations \u2192 WhatsApp and generate a new code.",
    };
  }

  if (normalizePairingCode(pairingCodeInput) !== normalizePairingCode(expected)) {
    return {
      ok: false,
      message: "Invalid pairing code. Copy it from Integrations \u2192 WhatsApp and try again.",
    };
  }

  const isLid = jid.endsWith("@lid");
  const phoneFromJid = isLid ? "" : whatsAppUserDigits(jid);
  const pairedLid = isLid ? jid : config.pairedLid;
  const pairedJid = isLid
    ? config.pairedJid ?? (config.phoneNumber ? phoneToWhatsAppJid(config.phoneNumber) : null)
    : jid;

  await writeWhatsAppConfigFile({
    ...config,
    phoneNumber: phoneFromJid || config.phoneNumber,
    pairedJid,
    pairedLid,
    pairingCode: null,
  });

  return {
    ok: true,
    message: "Linked successfully. You can chat with Nakama now.",
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
    phoneNumber: ownerPhone || config.phoneNumber,
    pairedJid: config.pairedJid ?? options.ownerJid,
    // Preserve an existing chat LID. `me.lid` can be a device/account LID, which
    // does not always match the private self-chat JID used for inbound messages.
    pairedLid: config.pairedLid ?? ownerLid,
    pairingCode: null,
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

  if (!file && !env.WHATSAPP_PHONE_NUMBER?.trim()) {
    return null;
  }

  return {
    phoneNumber: env.WHATSAPP_PHONE_NUMBER?.trim() || file?.phoneNumber?.trim() || "",
    profileId:
      env.nakama_WHATSAPP_PROFILE_ID?.trim() ||
      file?.profileId?.trim() ||
      DEFAULT_WHATSAPP_PROFILE_ID,
    pairingCode: file?.pairingCode ?? null,
    pairedJid: file?.pairedJid ?? null,
    pairedLid: file?.pairedLid ?? null,
  };
}
