import {
  areJidsSameUser,
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

  return (
    message.conversation ??
    message.extendedTextMessage?.text ??
    ""
  ).trim();
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
