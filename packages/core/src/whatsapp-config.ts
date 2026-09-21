import { randomBytes } from "node:crypto";
import { rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  assertChannelPath,
  type ChannelConfigScope,
  claimChannelIdentity,
  generateHandshakeCode,
  getChannelConfigDir,
  isChannelOwner,
  normalizeHandshakeInput,
  releaseChannelClaims,
  resetChannelConversationState,
} from "./channel-config-shared";
import {
  ensureDir,
  parseIni,
  pathExists,
  readDirectoryOrEmpty,
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
export const DEFAULT_WHATSAPP_REQUIRE_GROUP_MENTION = true;

export interface WhatsAppConfigFile {
  allowedPhones: string[];
  outboundPort?: string | null;
  outboundToken?: string | null;
  pairedJid: string | null;
  pairedLid: string | null;
  pairingCode: string | null;
  phoneNumber: string;
  profileId: string;
  requireGroupMention: boolean;
}

export interface WhatsAppSettingsPublic {
  allowedPhones: string[];
  configured: boolean;
  pairedJid: string | null;
  pairingCode: string | null;
  phoneNumberMasked: string | null;
  profileId: string;
  requireGroupMention: boolean;
}

export interface UpdateWhatsAppSettingsInput {
  allowedPhones?: string;
  phoneNumber?: string;
  profileId?: string;
  requireGroupMention?: boolean;
}

export type WhatsAppConfigScope = ChannelConfigScope;

export function getWhatsAppConfigDir(
  orgId: WhatsAppConfigScope = null
): string {
  return getChannelConfigDir("whatsapp", orgId);
}

export function getWhatsAppConfigPath(
  orgId: WhatsAppConfigScope = null
): string {
  const path = join(getWhatsAppConfigDir(orgId), "config.ini");
  if (isChannelOwner(orgId)) {
    assertChannelPath(path);
    assertChannelPath(`${path}.tmp`);
  }
  return path;
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

  if (server !== "s.whatsapp.net" && server !== "lid") {
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
    whatsAppJidServer(left) !== whatsAppJidServer(right) ||
    (whatsAppJidServer(left) !== "s.whatsapp.net" &&
      whatsAppJidServer(left) !== "lid")
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
  jids: readonly string[],
  orgId: WhatsAppConfigScope = null
): Promise<void> {
  const config = await loadWhatsAppConfigFile(orgId);

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

  await writeWhatsAppConfigFile(
    {
      ...config,
      pairedJid: nextPairedJid,
      pairedLid: nextPairedLid,
    },
    orgId
  );
}

export async function loadWhatsAppConfigFile(
  orgId: WhatsAppConfigScope = null
): Promise<WhatsAppConfigFile | null> {
  const raw = await readTextOrNull(getWhatsAppConfigPath(orgId));

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
    requireGroupMention: parseIniBoolean(
      values.require_group_mention,
      DEFAULT_WHATSAPP_REQUIRE_GROUP_MENTION
    ),
  };
}

/**
 * Shared secret for the loopback outbound server, minted on first use and kept
 * in the 0600 config file, so a process running as another user cannot post to
 * 127.0.0.1/send and make the bot message the paired owner.
 */
export async function ensureWhatsAppOutboundToken(
  orgId: WhatsAppConfigScope = null
): Promise<string | null> {
  const config = await loadWhatsAppConfigFile(orgId);

  if (!config) {
    return null;
  }

  if (config.outboundToken) {
    return config.outboundToken;
  }

  const outboundToken = randomBytes(32).toString("hex");
  await writeWhatsAppConfigFile({ ...config, outboundToken }, orgId);

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
      requireGroupMention: DEFAULT_WHATSAPP_REQUIRE_GROUP_MENTION,
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
    requireGroupMention: file.requireGroupMention,
  };
}

export async function loadWhatsAppSettingsPublic(
  orgId: WhatsAppConfigScope = null
): Promise<WhatsAppSettingsPublic> {
  return toWhatsAppSettingsPublic(await loadWhatsAppConfigFile(orgId));
}

async function writeWhatsAppConfigFile(
  config: WhatsAppConfigFile,
  orgId: WhatsAppConfigScope = null
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
    `require_group_mention=${config.requireGroupMention ? "true" : "false"}`,
    "",
  ];

  await writeTextFile(getWhatsAppConfigPath(orgId), lines.join("\n"), {
    ensureDir: getWhatsAppConfigDir(orgId),
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
    outboundPort: existing?.outboundPort ?? null,
    outboundToken: existing?.outboundToken ?? null,
    pairedJid,
    pairedLid: existing?.pairedLid ?? null,
    pairingCode: resolvePairingCode(existing, pairedJid),
    phoneNumber,
    profileId: resolveProfileId(input, existing),
    requireGroupMention: resolveRequireGroupMention(input, existing),
  };
}

function resolveRequireGroupMention(
  input: UpdateWhatsAppSettingsInput,
  existing: WhatsAppConfigFile | null
): boolean {
  return input.requireGroupMention === undefined
    ? (existing?.requireGroupMention ?? DEFAULT_WHATSAPP_REQUIRE_GROUP_MENTION)
    : input.requireGroupMention;
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
  input: UpdateWhatsAppSettingsInput,
  orgId: WhatsAppConfigScope = null
): Promise<WhatsAppSettingsPublic> {
  const existing = await loadWhatsAppConfigFile(orgId);
  const next = buildSavedWhatsAppConfig(input, existing);
  if (isChannelOwner(orgId)) {
    next.profileId = orgId.profileId;
  }
  await writeWhatsAppConfigFile(next, orgId);
  return toWhatsAppSettingsPublic(next);
}

function getWhatsAppAuthDir(orgId: WhatsAppConfigScope = null): string {
  return join(getWhatsAppConfigDir(orgId), "auth");
}

// ponytail: filename mirrors whatsapp-worker.ts QR_CODE_FILENAME
function getWhatsAppQrCodePath(orgId: WhatsAppConfigScope = null): string {
  return join(getWhatsAppConfigDir(orgId), "worker-qr.txt");
}

export async function resetWhatsAppSessionForReconnect(
  orgId: WhatsAppConfigScope = null
): Promise<WhatsAppSettingsPublic> {
  const existing = await loadWhatsAppConfigFile(orgId);

  if (!existing) {
    throw new Error(
      "Enable WhatsApp in this agent’s Connections before reconnecting."
    );
  }

  if (await pathExists(getWhatsAppAuthDir(orgId))) {
    await rm(getWhatsAppAuthDir(orgId), { force: true, recursive: true });
  }

  const qrPath = getWhatsAppQrCodePath(orgId);
  if (await pathExists(qrPath)) {
    await removeFile(qrPath);
  }

  if (isChannelOwner(orgId)) {
    await resetChannelConversationState("whatsapp", orgId);
    await releaseChannelClaims("whatsapp", orgId);
  }
  const next: WhatsAppConfigFile = {
    ...existing,
    outboundPort: null,
    outboundToken: null,
    pairedJid: null,
    pairedLid: null,
    pairingCode: null,
  };

  await writeWhatsAppConfigFile(next, orgId);
  return toWhatsAppSettingsPublic(next);
}

export async function regenerateWhatsAppPairingCode(
  orgId: WhatsAppConfigScope = null
): Promise<WhatsAppSettingsPublic> {
  const existing = await loadWhatsAppConfigFile(orgId);

  if (!existing) {
    throw new Error(
      "Enable WhatsApp in this agent’s Connections before generating a pairing code."
    );
  }

  const next: WhatsAppConfigFile = {
    ...existing,
    pairingCode: generatePairingCode(),
  };

  await writeWhatsAppConfigFile(next, orgId);
  return toWhatsAppSettingsPublic(next);
}

export async function verifyAndPairWhatsAppUser(
  pairingCodeInput: string,
  jid: string,
  orgId: WhatsAppConfigScope = null
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const config = await loadWhatsAppConfigFile(orgId);

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
        "No pairing code is active. Open this agent’s Connections \u2192 WhatsApp and generate a new code.",
      ok: false,
    };
  }

  if (
    normalizePairingCode(pairingCodeInput) !== normalizePairingCode(expected)
  ) {
    return {
      message:
        "Invalid pairing code. Copy it from this agent’s Connections \u2192 WhatsApp and try again.",
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

  await writeWhatsAppConfigFile(
    {
      ...config,
      pairedJid,
      pairedLid,
      pairingCode: null,
      phoneNumber: phoneFromJid || config.phoneNumber,
    },
    orgId
  );

  return {
    message: "Linked successfully. You can chat with Nakama now.",
    ok: true,
  };
}

/** After QR link, pair the owner and store their LID for inbound routing. */
export async function syncWhatsAppOwnerPairing(
  options: {
    ownerJid: string;
    ownerLid?: string | null;
  },
  orgId: WhatsAppConfigScope = null
): Promise<void> {
  const config = await loadWhatsAppConfigFile(orgId);

  if (!config) {
    return;
  }

  if (isChannelOwner(orgId)) {
    await claimChannelIdentity(
      "whatsapp",
      orgId,
      normalizeWhatsAppUserJid(options.ownerJid)
    );
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

  await writeWhatsAppConfigFile(next, orgId);
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
    requireGroupMention:
      file?.requireGroupMention ?? DEFAULT_WHATSAPP_REQUIRE_GROUP_MENTION,
  };
}

function parseIniBoolean(
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

/** Configured orgs are enumerated for worker recovery; credentials never fall back across orgs. */
export async function listWhatsAppConfigOrgIds(): Promise<string[]> {
  const configured: string[] = [];
  for (const orgId of await readDirectoryOrEmpty(
    join(getUserConfigDir(), "orgs")
  )) {
    if (await pathExists(getWhatsAppConfigPath(orgId))) {
      configured.push(orgId);
    }
  }
  return configured;
}

/** Called with the oldest organization, after stopping the legacy worker. */
export async function claimLegacyWhatsAppConfig(
  orgId: string
): Promise<boolean> {
  const legacyDir = getWhatsAppConfigDir();
  const targetDir = getWhatsAppConfigDir(orgId);
  if (
    !(await pathExists(getWhatsAppConfigPath())) ||
    (await pathExists(targetDir))
  ) {
    return false;
  }
  await ensureDir(dirname(targetDir));
  await rename(legacyDir, targetDir);
  return true;
}

/** Persist the ephemeral loopback port allocated to this account's worker. */
export async function saveWhatsAppOutboundPort(
  port: number,
  orgId: WhatsAppConfigScope = null
): Promise<void> {
  const config = await loadWhatsAppConfigFile(orgId);
  if (config) {
    await writeWhatsAppConfigFile(
      { ...config, outboundPort: String(port) },
      orgId
    );
  }
}
