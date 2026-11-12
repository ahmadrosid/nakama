import { areJidsSameUser } from "@whiskeysockets/baileys";

export interface WhatsAppAccount {
  id: string;
  lid?: string | null;
}

export interface GroupMessageHandlingDecision {
  reason:
    | "slash-command"
    | "missing-bot-info"
    | "reply-to-bot"
    | "bot-mention"
    | "open-listen"
    | "no-text"
    | "no-trigger";
  shouldHandle: boolean;
}

// IDs of messages Nakama sent. The linked account is often the user's own
// number, so a quote of that number is only a reply to Nakama when the quoted
// message is one Nakama sent. Bounded; lost on restart (fails closed).
const MAX_BOT_MESSAGE_IDS = 2000;

const botMessageIds = new Set<string>();

export function rememberWhatsAppBotMessage(
  id: string | null | undefined
): void {
  const trimmed = id?.trim();

  if (!trimmed) {
    return;
  }

  botMessageIds.delete(trimmed);
  botMessageIds.add(trimmed);

  if (botMessageIds.size > MAX_BOT_MESSAGE_IDS) {
    const oldest = botMessageIds.values().next().value;

    if (oldest) {
      botMessageIds.delete(oldest);
    }
  }
}

function isWhatsAppBotMessage(id: string | null | undefined): boolean {
  const trimmed = id?.trim();

  return Boolean(trimmed && botMessageIds.has(trimmed));
}

export function resetWhatsAppBotMessagesForTests(): void {
  botMessageIds.clear();
}

export function resolveChannelOrgKey(jid: string, isGroup: boolean): string {
  return isGroup ? `g:${jid}` : jid;
}

export function isWhatsAppBotAddress(
  jid: string | null | undefined,
  me: WhatsAppAccount | undefined
): boolean {
  if (!(jid && me)) {
    return false;
  }

  if (areJidsSameUser(jid, me.id)) {
    return true;
  }

  return Boolean(me.lid && areJidsSameUser(jid, me.lid));
}

export function explainGroupMessageHandling(input: {
  mentionedJids: string[];
  quotedMessageId?: string | null;
  quotedParticipant: string | null;
  text: string;
  me?: WhatsAppAccount | undefined;
  requireMention?: boolean;
}): GroupMessageHandlingDecision {
  const text = input.text.trim();

  if (text.startsWith("/")) {
    return { reason: "slash-command", shouldHandle: true };
  }

  if (input.requireMention === false) {
    return {
      reason: text ? "open-listen" : "no-text",
      shouldHandle: Boolean(text),
    };
  }

  if (!input.me) {
    return { reason: "missing-bot-info", shouldHandle: false };
  }

  if (
    isWhatsAppBotAddress(input.quotedParticipant, input.me) &&
    isWhatsAppBotMessage(input.quotedMessageId)
  ) {
    return { reason: "reply-to-bot", shouldHandle: true };
  }

  if (input.mentionedJids.some((jid) => isWhatsAppBotAddress(jid, input.me))) {
    return { reason: "bot-mention", shouldHandle: true };
  }

  return {
    reason: text ? "no-trigger" : "no-text",
    shouldHandle: false,
  };
}

export function stripWhatsAppBotMention(text: string): string {
  return text.replace(/@\S+/g, "").replace(/\s+/g, " ").trim();
}

function isSameWhatsAppAddress(left: string, right: string): boolean {
  if (areJidsSameUser(left, right)) {
    return true;
  }

  const leftUser = left.split("@")[0]?.split(":")[0];
  const rightUser = right.split("@")[0]?.split(":")[0];
  const leftServer = left.split("@")[1];
  const rightServer = right.split("@")[1];

  return Boolean(
    leftUser &&
      leftUser === rightUser &&
      leftServer &&
      leftServer === rightServer
  );
}

export function extraJidsFromGroupParticipants(
  participants: ReadonlyArray<{
    id?: string | null;
    jid?: string | null;
    lid?: string | null;
    phoneNumber?: string | null;
  }>,
  senderJids: readonly string[]
): string[] {
  const extras: string[] = [];

  for (const participant of participants) {
    const identities = [
      participant.id,
      participant.jid,
      participant.lid,
      participant.phoneNumber,
    ].filter((jid): jid is string => Boolean(jid));

    if (
      !identities.some((identity) =>
        senderJids.some((senderJid) =>
          isSameWhatsAppAddress(senderJid, identity)
        )
      )
    ) {
      continue;
    }

    extras.push(...identities);
  }

  return [...new Set(extras)];
}
