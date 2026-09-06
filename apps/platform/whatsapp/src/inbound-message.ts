import {
  areJidsSameUser,
  extractMessageContent,
  isJidGroup,
  isJidUser,
  isLidUser,
  type proto,
} from "@whiskeysockets/baileys";
import {
  explainGroupMessageHandling,
  type WhatsAppAccount,
} from "./group-message";

interface WhatsAppInboundKey {
  fromMe?: boolean | null;
  id?: string | null;
  participant?: string | null;
  participantLid?: string | null;
  participantPn?: string | null;
  remoteJid?: string | null;
  senderLid?: string | null;
  senderPn?: string | null;
}

export interface WhatsAppInboundChat {
  fromMe: boolean;
  isGroup: boolean;
  jid: string;
  me?: WhatsAppAccount;
  mentionedJids: string[];
  messageId: string | null;
  quotedParticipant: string | null;
  quotedText: string | null;
  senderJid: string;
  senderJids: string[];
  text: string;
}

const OUTBOUND_TTL_MS = 120_000;
const outboundSeenAt = new Map<string, number>();

export function rememberWhatsAppOutbound(input: {
  id?: string | null;
  jid: string;
  text?: string | null;
}): void {
  const now = Date.now();
  pruneWhatsAppOutbound(now);
  const id = input.id?.trim();
  if (id) {
    outboundSeenAt.set(`id:${input.jid}:${id}`, now);
  }

  const text = input.text?.trim();
  if (text) {
    outboundSeenAt.set(`text:${input.jid}:${text}`, now);
  }
}

export function isWhatsAppOutboundEcho(input: {
  fromMe: boolean;
  id?: string | null;
  jid: string;
  text: string;
}): boolean {
  pruneWhatsAppOutbound(Date.now());
  const id = input.id?.trim();
  if (!input.fromMe) {
    return false;
  }

  if (id && outboundSeenAt.has(`id:${input.jid}:${id}`)) {
    return true;
  }

  const text = input.text.trim();
  return Boolean(text && outboundSeenAt.has(`text:${input.jid}:${text}`));
}

export function resetWhatsAppOutboundForTests(): void {
  outboundSeenAt.clear();
}

function pruneWhatsAppOutbound(now: number): void {
  for (const [key, seenAt] of outboundSeenAt) {
    if (now - seenAt > OUTBOUND_TTL_MS) {
      outboundSeenAt.delete(key);
    }
  }
}

export function isPrivateWhatsAppChat(jid: string): boolean {
  return isJidUser(jid) || isLidUser(jid);
}

export function isSelfWhatsAppChat(
  remoteJid: string,
  me: WhatsAppAccount | undefined
): boolean {
  if (!me) {
    return false;
  }

  if (areJidsSameUser(remoteJid, me.id)) {
    return true;
  }

  return Boolean(me.lid && areJidsSameUser(remoteJid, me.lid));
}

export function extractInboundText(
  message: proto.IMessage | null | undefined
): string {
  if (!message) {
    return "";
  }

  const extracted = extractMessageContent(message) ?? message;
  const direct = readTextContent(extracted);

  if (direct) {
    return direct;
  }

  const materialized = materializeMessage(extracted);
  return readTextContent(materialized);
}

function extractMentionedJids(
  message: proto.IMessage | null | undefined
): string[] {
  return (
    extractContextInfo(message)?.mentionedJid?.filter((jid): jid is string =>
      Boolean(jid)
    ) ?? []
  );
}

function extractQuotedParticipant(
  message: proto.IMessage | null | undefined
): string | null {
  return extractContextInfo(message)?.participant ?? null;
}

function extractQuotedText(
  message: proto.IMessage | null | undefined
): string | null {
  const quotedMessage = extractContextInfo(message)?.quotedMessage;
  const quotedText = extractInboundText(quotedMessage).trim();
  return quotedText || null;
}

export function shouldHandleInboundMessage(
  msg: {
    key: WhatsAppInboundKey;
    message?: proto.IMessage | null;
  },
  me: WhatsAppAccount | undefined,
  options?: { requireGroupMention?: boolean }
): boolean {
  return parseInboundWhatsAppMessage(msg, me, options) !== null;
}

export function parseInboundWhatsAppMessage(
  msg: {
    key: WhatsAppInboundKey;
    message?: proto.IMessage | null;
  },
  me: WhatsAppAccount | undefined,
  options?: { requireGroupMention?: boolean }
): WhatsAppInboundChat | null {
  const remoteJid = msg.key.remoteJid;
  const text = extractInboundText(msg.message);

  if (!(remoteJid && text)) {
    return null;
  }

  const isGroup = Boolean(isJidGroup(remoteJid));
  const fromMe = Boolean(msg.key.fromMe);
  const mentionedJids = extractMentionedJids(msg.message);
  const quotedParticipant = extractQuotedParticipant(msg.message);
  const quotedText = extractQuotedText(msg.message);

  if (isGroup) {
    const decision = explainGroupMessageHandling({
      me,
      mentionedJids,
      quotedParticipant,
      requireMention: options?.requireGroupMention,
      text,
    });

    if (!decision.shouldHandle) {
      return null;
    }
  } else if (!isPrivateWhatsAppChat(remoteJid)) {
    return null;
  } else if (fromMe && !isSelfWhatsAppChat(remoteJid, me)) {
    return null;
  }

  const senderJids = collectSenderJids(msg.key, remoteJid, isGroup, me);
  const senderJid = senderJids[0] ?? "";

  if (isGroup && !senderJid) {
    return null;
  }

  return {
    fromMe,
    isGroup,
    jid: remoteJid,
    me,
    mentionedJids,
    messageId: msg.key.id?.trim() || null,
    quotedParticipant,
    quotedText,
    senderJid,
    senderJids,
    text,
  };
}

function collectSenderJids(
  key: WhatsAppInboundKey,
  remoteJid: string,
  isGroup: boolean,
  me: WhatsAppAccount | undefined
): string[] {
  const record = key as WhatsAppInboundKey & Record<string, unknown>;
  const extraIdentities = [
    record.participantAlt,
    record.remoteJidAlt,
    record.senderPn,
    record.participantPn,
    record.senderLid,
    record.participantLid,
  ];
  const candidates = isGroup
    ? [
        key.participantPn,
        key.senderPn,
        key.participant,
        key.participantLid,
        key.senderLid,
        ...extraIdentities,
        key.fromMe && me ? me.id : null,
        key.fromMe && me?.lid ? me.lid : null,
      ]
    : [
        remoteJid,
        key.senderPn,
        key.senderLid,
        key.participant,
        key.participantPn,
        key.participantLid,
        ...extraIdentities,
      ];

  return [
    ...new Set(
      candidates.filter(
        (jid): jid is string => typeof jid === "string" && Boolean(jid)
      )
    ),
  ];
}

function extractContextInfo(
  message: proto.IMessage | null | undefined
): proto.IContextInfo | undefined {
  if (!message) {
    return;
  }

  const extracted = extractMessageContent(message) ?? message;
  const materialized = materializeMessage(extracted) ?? extracted;

  return (
    materialized.extendedTextMessage?.contextInfo ??
    materialized.imageMessage?.contextInfo ??
    materialized.videoMessage?.contextInfo ??
    materialized.documentMessage?.contextInfo ??
    undefined
  );
}

function readTextContent(
  message: Partial<proto.IMessage> | null | undefined
): string {
  return (
    message?.conversation ??
    message?.extendedTextMessage?.text ??
    message?.imageMessage?.caption ??
    message?.videoMessage?.caption ??
    ""
  ).trim();
}

function materializeMessage(
  message: Partial<proto.IMessage> | null | undefined
): Partial<proto.IMessage> | null {
  if (!message) {
    return null;
  }

  try {
    return JSON.parse(JSON.stringify(message)) as Partial<proto.IMessage>;
  } catch {
    return null;
  }
}
