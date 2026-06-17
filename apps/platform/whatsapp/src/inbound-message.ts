import {
  areJidsSameUser,
  extractMessageContent,
  isJidGroup,
  isJidUser,
  isLidUser,
  type proto,
} from "@whiskeysockets/baileys";

export function isPrivateWhatsAppChat(jid: string): boolean {
  return isJidUser(jid) || isLidUser(jid);
}

export function isSelfWhatsAppChat(
  remoteJid: string,
  me: { id: string; lid?: string | null } | undefined,
): boolean {
  if (!me) {
    return false;
  }

  if (areJidsSameUser(remoteJid, me.id)) {
    return true;
  }

  return Boolean(me.lid && areJidsSameUser(remoteJid, me.lid));
}

export function extractInboundText(message: proto.IMessage | null | undefined): string {
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

function readTextContent(message: Partial<proto.IMessage> | null | undefined): string {
  return (
    message?.conversation ??
    message?.extendedTextMessage?.text ??
    message?.imageMessage?.caption ??
    message?.videoMessage?.caption ??
    ""
  ).trim();
}

function materializeMessage(
  message: Partial<proto.IMessage> | null | undefined,
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

export function shouldHandleInboundMessage(
  msg: { key: { fromMe?: boolean | null; remoteJid?: string | null }; message?: proto.IMessage | null },
  me: { id: string; lid?: string | null } | undefined,
): boolean {
  const remoteJid = msg.key.remoteJid;

  if (!remoteJid || isJidGroup(remoteJid) || !isPrivateWhatsAppChat(remoteJid)) {
    return false;
  }

  if (msg.key.fromMe && !isSelfWhatsAppChat(remoteJid, me)) {
    return false;
  }

  return Boolean(extractInboundText(msg.message));
}
