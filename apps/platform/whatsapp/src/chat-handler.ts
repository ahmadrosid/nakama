import type { NakamaClient, RemoteChatSession } from "@nakama/client";
import {
  extractPairedTurnArtifacts,
  isAttachOnlyCommand,
  isFreshReportRequest,
  pushDeliverableArtifact,
} from "@nakama/core";
import { formatClientError } from "@nakama/core/api-error";
import {
  clearActiveStream,
  isAbortError,
  registerActiveStream,
  stopActiveStream,
} from "@nakama/core/channel-active-stream";
import { createChatLock } from "@nakama/core/channel-chat-lock";
import {
  type ChannelOrgStore,
  findOrgBySelectionInput,
  formatOrgSelectionPrompt,
  formatOrgSwitchConfirmation,
  prepareChannelOrgContext,
} from "@nakama/core/channel-org";
import type { ChannelSessionStore } from "@nakama/core/channel-session-store";
import { createTypingLoop } from "@nakama/core/channel-typing-loop";
import type { SendMessageInput } from "@nakama/core/contract";
import { pickProfileForOrg } from "@nakama/core/profiles";
import {
  DEFAULT_WHATSAPP_REQUIRE_GROUP_MENTION,
  normalizePairingCode,
} from "@nakama/core/whatsapp-config";
import type { WASocket } from "@whiskeysockets/baileys";
import type { WhatsAppAuthStore } from "./auth-store";
import {
  maybeSendRequestedWhatsAppArtifactAttachment,
  maybeSendWhatsAppAttachOnlyCommand,
  sendArtifactDocumentForPath,
} from "./channel-artifact-flow";
import { isChannelDebugEnabled } from "./channel-log";
import type { WhatsAppBridgeConfig } from "./config";
import {
  HELP_TEXT,
  prepareWhatsAppReply,
  splitWhatsAppMessage,
} from "./format";
import {
  explainGroupMessageHandling,
  extraJidsFromGroupParticipants,
  isWhatsAppBotAddress,
  resolveChannelOrgKey,
  stripWhatsAppBotMention,
} from "./group-message";
import {
  isWhatsAppOutboundEcho,
  rememberWhatsAppOutbound,
  type WhatsAppInboundChat,
} from "./inbound-message";
import { maskWhatsAppJid } from "./log-metadata";
import { WhatsAppTodoStatusMessage } from "./todo-status-message";

const chatLock = createChatLock();

const GROUP_MESSAGE_PREFIX =
  "[WhatsApp group — your reply is visible to everyone in this group.]\n";

const LINK_IN_PRIVATE_REPLY =
  "This WhatsApp number is not linked yet. Open a private chat with this account and send your pairing code from Integrations → WhatsApp.";

const ALREADY_LINKED_REPLY = "This number is already linked.";

const PAIRING_PROMPT =
  "Welcome to Nakama.\n\n" +
  "Paste your pairing code from Integrations \u2192 WhatsApp in the web dashboard. " +
  "You only need to do this once for this number.";

export interface ChatHandlerDeps {
  authStore: WhatsAppAuthStore;
  client: NakamaClient;
  config: WhatsAppBridgeConfig;
  getSocket: () => WASocket | null;
  orgStore: ChannelOrgStore;
  sessionStore: ChannelSessionStore;
}

export function createChatHandler(deps: ChatHandlerDeps) {
  const { client, config, authStore, sessionStore, orgStore, getSocket } = deps;

  return async function handleMessage(
    data: Pick<WhatsAppInboundChat, "jid" | "text"> &
      Partial<Omit<WhatsAppInboundChat, "jid" | "text">>
  ): Promise<void> {
    const inbound = normalizeInboundChat(data);
    const { jid, text } = inbound;

    if (!(text && text.trim())) {
      return;
    }

    const trimmed = text.trim();
    if (
      isWhatsAppOutboundEcho({
        fromMe: inbound.fromMe,
        id: inbound.messageId,
        jid,
        text: trimmed,
      })
    ) {
      if (isChannelDebugEnabled()) {
        console.log(
          [
            "Ignored WhatsApp outbound echo",
            `jid=${maskWhatsAppJid(jid)}`,
            `fromMe=${inbound.fromMe ? "yes" : "no"}`,
            `textBytes=${Buffer.byteLength(trimmed, "utf8")}`,
          ].join(" ")
        );
      }
      return;
    }

    const isGroup = inbound.isGroup;
    const conversationKey = jid;
    const channelOrgKey = resolveChannelOrgKey(jid, isGroup);
    await authStore.reload();
    const requireGroupMention =
      authStore.getConfig()?.requireGroupMention ??
      DEFAULT_WHATSAPP_REQUIRE_GROUP_MENTION;
    const groupDecision = isGroup
      ? explainGroupMessageHandling({
          me: inbound.me,
          mentionedJids: inbound.mentionedJids,
          quotedParticipant: inbound.quotedParticipant,
          requireMention: requireGroupMention,
          text: trimmed,
        })
      : null;

    if (groupDecision && !groupDecision.shouldHandle) {
      if (isChannelDebugEnabled()) {
        console.log(
          [
            "Ignored WhatsApp group message",
            `reason=${groupDecision.reason}`,
            `jid=${maskWhatsAppJid(jid)}`,
            `sender=${maskWhatsAppJid(inbound.senderJid)}`,
            `textBytes=${Buffer.byteLength(trimmed, "utf8")}`,
          ].join(" ")
        );
      }
      return;
    }

    if (isStopCommand(trimmed)) {
      if (!stopActiveStream(conversationKey)) {
        await sendText(jid, "Nothing to stop.");
      }

      return;
    }

    await withChatLock(conversationKey, async () => {
      await authStore.reload();
      const senderJids = [...inbound.senderJids];
      const pairingText = isGroup ? stripWhatsAppBotMention(trimmed) : trimmed;
      let authorized =
        inbound.fromMe ||
        authStore.isAuthorized(senderJids) ||
        senderJids.some((senderJid) =>
          isWhatsAppBotAddress(senderJid, inbound.me)
        );

      if (!authorized && isGroup) {
        const resolvedSenderJids = await resolveGroupSenderJids(
          jid,
          senderJids
        );
        senderJids.push(...resolvedSenderJids);
        authorized =
          authStore.isAuthorized(senderJids) || requireGroupMention === false;
      }

      if (authorized) {
        await authStore.rememberIdentities(senderJids);
      }

      if (!authorized) {
        if (!authStore.getConfig()?.pairingCode) {
          if (isChannelDebugEnabled()) {
            console.log(
              [
                "Ignored WhatsApp message",
                "reason=unauthorized",
                `jid=${maskWhatsAppJid(jid)}`,
                `sender=${maskWhatsAppJid(inbound.senderJid)}`,
                `textBytes=${Buffer.byteLength(trimmed, "utf8")}`,
              ].join(" ")
            );
          }
          return;
        }

        if (isGroup) {
          if (looksLikePairingCodeAttempt(pairingText)) {
            await handlePairing(inbound.senderJid, pairingText);
            return;
          }

          if (groupDecision?.reason === "open-listen") {
            return;
          }

          await sendText(jid, LINK_IN_PRIVATE_REPLY);
          return;
        }

        await handlePairing(jid, trimmed);
        return;
      }

      if (looksLikePairingCodeAttempt(pairingText)) {
        await sendText(jid, ALREADY_LINKED_REPLY);
        return;
      }

      const command = trimmed.startsWith("/") ? parseCommand(trimmed) : null;
      const bypassOrgGate =
        command === "/help" || command === "/start" || command === "/org";
      const orgGateText = isGroup ? stripWhatsAppBotMention(trimmed) : trimmed;

      if (!bypassOrgGate) {
        const orgReady = await ensureOrgReady(channelOrgKey, orgGateText, jid);
        if (!orgReady) {
          return;
        }
      }

      const attachUserText = isGroup
        ? stripWhatsAppBotMention(trimmed)
        : trimmed;

      // After pairing + org-ready: `/attach` skips handleCommand, not auth/org.
      if (isAttachOnlyCommand(attachUserText)) {
        const socket = getSocket();
        if (!socket) {
          await sendText(jid, "WhatsApp is not connected.");
          return;
        }

        await resolveSession(conversationKey);
        const profileId =
          sessionStore.get(conversationKey)?.profileId ??
          (await resolveProfileId());

        await maybeSendWhatsAppAttachOnlyCommand({
          client,
          conversationKey,
          jid,
          profileId,
          sendPlain: (text) => sendText(jid, text),
          sessionStore,
          socket,
        });
        return;
      }

      if (trimmed.startsWith("/")) {
        await handleCommand(conversationKey, channelOrgKey, jid, trimmed);
        return;
      }

      await handleChatMessage(
        conversationKey,
        jid,
        {
          message: withGroupContext(
            withQuotedContext(attachUserText, inbound.quotedText),
            isGroup
          ),
        },
        attachUserText
      );
    });
  };

  async function handlePairing(jid: string, text: string): Promise<void> {
    const command = parseCommand(text);

    if (command === "/help") {
      await sendText(jid, `${PAIRING_PROMPT}\n\n${HELP_TEXT}`);
      return;
    }

    if (!looksLikePairingCodeAttempt(text)) {
      await sendText(jid, PAIRING_PROMPT);
      return;
    }

    const result = await authStore.tryPair(text, jid);
    await sendText(jid, result.message);
  }

  async function handleCommand(
    conversationKey: string,
    channelOrgKey: string,
    jid: string,
    text: string
  ): Promise<void> {
    const command = parseCommand(text);

    switch (command) {
      case "/start":
      case "/help":
        await sendText(jid, HELP_TEXT);
        return;

      case "/clear": {
        const session = await resolveSession(conversationKey);
        await session.clear();
        await clearSessionArtifactState(conversationKey);
        await sendText(jid, "History cleared.");
        return;
      }

      case "/compact": {
        const session = await resolveSession(conversationKey);
        const result = await session.compact({ force: true });
        await sendText(
          jid,
          `Compacted (${result.action}). Messages: ${result.messagesAfter}.`
        );
        return;
      }

      case "/new": {
        await createAndBindSession(conversationKey);
        await sendText(jid, "Started a new conversation.");
        return;
      }

      case "/status":
        await replyStatus(jid);
        return;

      case "/org":
        await handleOrgCommand(conversationKey, channelOrgKey, jid, text);
        return;

      default:
        await sendText(jid, "Unknown command. Try /help");
    }
  }

  async function ensureOrgReady(
    channelOrgKey: string,
    messageText: string,
    replyJid: string
  ): Promise<boolean> {
    const orgContext = await prepareChannelOrgContext({
      getSelectedOrgId: () => orgStore.get(channelOrgKey)?.orgId,
      listOrgs: () => client.listUserOrgs(),
      saveSelectedOrgId: async (orgId) => {
        orgStore.set(channelOrgKey, orgId);
        await orgStore.save();
      },
      text: messageText.startsWith("/") ? undefined : messageText,
    });

    if (orgContext.status === "empty") {
      await sendText(replyJid, "No organizations are configured yet.");
      return false;
    }

    if (orgContext.status === "prompt") {
      await sendText(replyJid, orgContext.message);
      return false;
    }

    client.setOrgId(orgContext.orgId);

    if (orgContext.justSelected) {
      await sendText(replyJid, formatOrgSwitchConfirmation(orgContext.orgName));
      return false;
    }

    return true;
  }

  async function handleOrgCommand(
    conversationKey: string,
    channelOrgKey: string,
    jid: string,
    text: string
  ): Promise<void> {
    const { orgs } = await client.listUserOrgs();

    if (orgs.length === 0) {
      await sendText(jid, "No organizations are configured yet.");
      return;
    }

    const arg = text.trim().split(/\s+/).slice(1).join(" ");
    if (!arg) {
      await sendText(
        jid,
        formatOrgSelectionPrompt(orgs, orgStore.get(channelOrgKey)?.orgId)
      );
      return;
    }

    const picked = findOrgBySelectionInput(arg, orgs);
    if (!picked) {
      await sendText(jid, "Unknown organization. Send /org to see the list.");
      return;
    }

    const previousOrgId = orgStore.get(channelOrgKey)?.orgId;
    orgStore.set(channelOrgKey, picked.id);
    await orgStore.save();
    client.setOrgId(picked.id);

    if (previousOrgId && previousOrgId !== picked.id) {
      sessionStore.delete(conversationKey);
      await sessionStore.save();
    }

    await sendText(jid, formatOrgSwitchConfirmation(picked.name));
  }

  async function handleChatMessage(
    conversationKey: string,
    jid: string,
    input: SendMessageInput,
    attachUserText: string
  ): Promise<void> {
    const session = await resolveSession(conversationKey);
    const profileId = sessionStore.get(conversationKey)?.profileId;
    const socket = getSocket();

    // ponytail: imperative phrases only; use an explicit send tool for richer requests.
    // Freshness markers (harian/today/…) mean "build it now": never serve the
    // registry without an agent turn, or yesterday's file goes out as today's.
    const wantsFreshReport = isFreshReportRequest(attachUserText);
    const createsArtifact =
      wantsFreshReport ||
      /^\s*(?:(?:please|tolong)\s+)?(?:collect|create|generate|save|buat(?:kan)?|rekap(?:kan)?)\b/i.test(
        attachUserText
      );
    if (profileId && socket && !createsArtifact) {
      const attached = await maybeSendRequestedWhatsAppArtifactAttachment({
        attachUserText,
        client,
        conversationKey,
        jid,
        profileId,
        sendPlain: (text) => sendText(jid, text),
        sessionStore,
        socket,
      });
      // Same as /attach: once a document is sent, do not run the agent.
      if (attached) {
        return;
      }
    }

    const typingLoop = createTypingLoop(async () => {
      if (!socket) {
        return;
      }
      await socket.sendPresenceUpdate("composing", jid);
    });
    const todoStatus = new WhatsAppTodoStatusMessage(socket, jid);
    let reply = "";
    const signal = registerActiveStream(conversationKey);

    try {
      typingLoop.start();

      reply = await session.sendStream(
        input,
        {
          onChunk: (delta) => {
            reply += delta;
          },
          onThinking: () => {
            typingLoop.ping();
          },
          onTodosUpdated: (todos) => {
            typingLoop.ping();
            void todoStatus.update(todos);
          },
          onToolEnd: () => {
            typingLoop.ping();
          },
          onToolStart: () => {
            typingLoop.ping();
          },
        },
        { signal }
      );

      await todoStatus.complete();

      if (signal.aborted) {
        if (reply.trim()) {
          await sendText(jid, reply.trim());
        }

        await sendText(jid, "Stopped.");
        return;
      }
    } catch (error) {
      if (isAbortError(error)) {
        await todoStatus.stop();
        if (reply.trim()) {
          await sendText(jid, reply.trim());
        }

        await sendText(jid, "Stopped.");
        return;
      }

      await todoStatus.fail();
      await sendText(jid, formatClientError(error));
      return;
    } finally {
      clearActiveStream(conversationKey);
      typingLoop.stop();
    }

    if (reply.trim()) {
      await sendText(jid, reply.trim());
    } else {
      await sendText(jid, "(empty reply)");
    }

    if (profileId) {
      const artifacts = extractPairedTurnArtifacts(await session.getMessages());
      if (artifacts.length === 0) {
        return;
      }
      let registry = sessionStore.getDeliverableArtifacts(conversationKey);
      for (const artifact of artifacts) {
        registry = pushDeliverableArtifact(registry, {
          ...artifact,
          sharePath: null,
          shareUrl: null,
        });
      }
      sessionStore.updateArtifactState(conversationKey, {
        deliverableArtifacts: registry,
      });
      await sessionStore.save();

      const postTurnSocket = getSocket();
      if (!postTurnSocket) {
        return;
      }
      for (const artifact of artifacts) {
        await sendArtifactDocumentForPath({
          ...artifact,
          client,
          jid,
          profileId,
          sendPlain: (text) => sendText(jid, text),
          socket: postTurnSocket,
        });
      }
    }
  }

  async function replyStatus(jid: string): Promise<void> {
    try {
      const health = await client.health();
      const lines = [
        `Server: ${health.ok ? "ok" : "degraded"}`,
        `Provider configured: ${health.providerConfigured ? "yes" : "no"}`,
      ];

      if (health.providerConfigured) {
        const models = await client.getModels();
        const profileId = await resolveProfileId();
        const profiles = await client.listProfiles();
        const profile = profiles.profiles.find(
          (entry) => entry.id === profileId
        );
        const modelLabel = profile?.model?.includes("::")
          ? profile.model.slice(profile.model.indexOf("::") + 2)
          : (profile?.model ?? "none");
        lines.push(`Provider: ${models.provider ?? "unknown"}`);
        lines.push(`Model: ${modelLabel}`);
      } else {
        lines.push("Chat runs in offline mode without an API key.");
      }

      await sendText(jid, lines.join("\n"));
    } catch (error) {
      await sendText(jid, formatClientError(error));
    }
  }

  async function resolveProfileId(): Promise<string> {
    const fileConfig = authStore.getConfig();
    const preferredProfileId =
      fileConfig?.profileId?.trim() || config.profileId;
    const profiles = await client.listProfiles();
    return pickProfileForOrg(profiles.profiles, preferredProfileId).id;
  }

  async function resolveSession(jid: string): Promise<RemoteChatSession> {
    const profileId = await resolveProfileId();
    const existing = sessionStore.get(jid);

    if (existing && existing.profileId === profileId) {
      const hot = sessionStore.getHotSession<RemoteChatSession>(jid);
      if (hot) {
        return hot;
      }

      const session = client.createChatSession(existing.sessionId, "whatsapp");

      try {
        await session.getMessages();
        sessionStore.setHotSession(jid, session);
        return session;
      } catch {
        // Session missing on server; create a new one below
      }
    }

    return createAndBindSession(jid, profileId);
  }

  async function createAndBindSession(
    jid: string,
    profileId?: string
  ): Promise<RemoteChatSession> {
    const resolvedProfileId = profileId ?? (await resolveProfileId());
    const session = await client.createSession("whatsapp", {
      profileId: resolvedProfileId,
    });

    sessionStore.set(jid, {
      profileId: resolvedProfileId,
      sessionId: session.id,
      updatedAt: new Date().toISOString(),
    });
    sessionStore.setHotSession(jid, session);
    await sessionStore.save();

    return session;
  }

  async function sendText(
    jid: string,
    text: string,
    options?: { raw?: boolean }
  ): Promise<void> {
    const socket = getSocket();
    if (!socket) {
      return;
    }

    const prepared = options?.raw ? text.trim() : prepareWhatsAppReply(text);
    if (!prepared) {
      return;
    }

    for (const chunk of splitWhatsAppMessage(prepared)) {
      rememberWhatsAppOutbound({ jid, text: chunk });
      const sent = await socket.sendMessage(jid, { text: chunk });
      rememberWhatsAppOutbound({
        id: readSentMessageId(sent),
        jid,
        text: chunk,
      });
    }
  }

  async function clearSessionArtifactState(
    conversationKey: string
  ): Promise<void> {
    const existing = sessionStore.get(conversationKey);
    if (!existing) {
      return;
    }

    sessionStore.set(conversationKey, {
      profileId: existing.profileId,
      sessionId: existing.sessionId,
      updatedAt: new Date().toISOString(),
    });
    await sessionStore.save();
  }

  async function resolveGroupSenderJids(
    groupJid: string,
    senderJids: readonly string[]
  ): Promise<string[]> {
    const socket = getSocket();
    if (!socket || typeof socket.groupMetadata !== "function") {
      return [];
    }

    try {
      const metadata = await socket.groupMetadata(groupJid);
      return extraJidsFromGroupParticipants(
        metadata.participants ?? [],
        senderJids
      );
    } catch {
      return [];
    }
  }
}

function readSentMessageId(sent: unknown): string | null {
  if (!sent || typeof sent !== "object") {
    return null;
  }

  const id = (sent as { key?: { id?: string | null } }).key?.id;
  return id?.trim() || null;
}

function normalizeInboundChat(
  data: Pick<WhatsAppInboundChat, "jid" | "text"> &
    Partial<Omit<WhatsAppInboundChat, "jid" | "text">>
): WhatsAppInboundChat {
  return {
    fromMe: data.fromMe ?? false,
    isGroup: data.isGroup ?? false,
    jid: data.jid,
    me: data.me,
    mentionedJids: data.mentionedJids ?? [],
    messageId: data.messageId ?? null,
    quotedParticipant: data.quotedParticipant ?? null,
    quotedText: data.quotedText ?? null,
    senderJid: data.senderJid ?? data.jid,
    senderJids: data.senderJids ?? [data.senderJid ?? data.jid],
    text: data.text,
  };
}

function withQuotedContext(message: string, quotedText: string | null): string {
  const quote = quotedText?.trim();
  if (!quote) {
    return message;
  }

  if (message.trim()) {
    return `[Quoted message]\n${quote}\n\n${message}`;
  }

  return `[Quoted message]\n${quote}`;
}

function withGroupContext(message: string, isGroup: boolean): string {
  if (!isGroup) {
    return message;
  }

  if (message.trim()) {
    return `${GROUP_MESSAGE_PREFIX}${message}`;
  }

  return GROUP_MESSAGE_PREFIX.trim();
}

function parseCommand(text: string): string {
  const token = text.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return token;
}

function isStopCommand(text: string): boolean {
  return parseCommand(text) === "/stop";
}

function looksLikePairingCodeAttempt(text: string): boolean {
  const trimmed = text.trim();

  if (!trimmed || /\s/.test(trimmed) || trimmed.startsWith("/")) {
    return false;
  }

  if (/^[0-9A-F]{8}$/.test(normalizePairingCode(trimmed))) {
    return true;
  }

  return trimmed === trimmed.toUpperCase() && /^[A-Z0-9-]{4,12}$/.test(trimmed);
}

export function resetChatLocksForTests(): void {
  chatLock.resetForTests();
}

export async function withChatLock(
  jid: string,
  fn: () => Promise<void>
): Promise<void> {
  return chatLock.withLock(jid, fn);
}

/** @internal Test helper — seed a predecessor promise (rejection-safety tests). */
export function seedChatLockForTests(
  jid: string,
  promise: Promise<void>
): void {
  chatLock.seedForTests(jid, promise);
}
