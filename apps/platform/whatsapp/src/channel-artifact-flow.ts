import type { NakamaClient, RemoteChatSession } from "@nakama/client";
import {
  deliverTurnArtifactShares,
  formatMissingAttachArtifactMessage,
  getMostRecentDeliverableArtifact,
  isAttachIntent,
} from "@nakama/core";
import type { ChannelSessionStore } from "@nakama/core/channel-session-store";
import type { WASocket } from "@whiskeysockets/baileys";
import {
  formatWhatsAppArtifactOversizeError,
  sendWhatsAppArtifactDocument,
  WHATSAPP_ARTIFACT_DOCUMENT_MAX_BYTES,
} from "./send-artifact-document";

/**
 * When the user asks to attach/send a file and a registry artifact exists,
 * sends the WhatsApp document. Returns true when attach was attempted so the
 * chat handler can skip the agent turn (avoids invented "can't attach" replies).
 */
export async function maybeSendRequestedWhatsAppArtifactAttachment(input: {
  client: NakamaClient;
  conversationKey: string;
  profileId: string;
  /** Raw user text before group-context prefixing. */
  attachUserText: string;
  sessionStore: ChannelSessionStore;
  socket: WASocket;
  jid: string;
  sendPlain: (text: string) => Promise<void>;
}): Promise<boolean> {
  if (!isAttachIntent(input.attachUserText)) {
    return false;
  }

  const artifact = getMostRecentDeliverableArtifact(
    input.sessionStore.getDeliverableArtifacts(input.conversationKey)
  );
  if (!artifact) {
    return false;
  }

  await sendArtifactDocumentForPath({
    ...input,
    filename: artifact.filename,
    mimeType: artifact.mimeType,
    path: artifact.path,
    sizeBytes: artifact.sizeBytes,
  });
  return true;
}

/** `/attach` shortcut: most recent registry artifact, or a missing-artifact message. */
export async function maybeSendWhatsAppAttachOnlyCommand(input: {
  client: NakamaClient;
  conversationKey: string;
  profileId: string;
  sessionStore: ChannelSessionStore;
  socket: WASocket;
  jid: string;
  sendPlain: (text: string) => Promise<void>;
}): Promise<void> {
  const artifact = getMostRecentDeliverableArtifact(
    input.sessionStore.getDeliverableArtifacts(input.conversationKey)
  );
  if (!artifact) {
    await input.sendPlain(formatMissingAttachArtifactMessage());
    return;
  }

  await sendArtifactDocumentForPath({
    ...input,
    filename: artifact.filename,
    mimeType: artifact.mimeType,
    path: artifact.path,
    sizeBytes: artifact.sizeBytes,
  });
}

export async function deliverWhatsAppTurnArtifactShares(input: {
  client: NakamaClient;
  session: RemoteChatSession;
  conversationKey: string;
  profileId: string;
  sessionStore: ChannelSessionStore;
  sendRaw: (text: string) => Promise<void>;
}): Promise<void> {
  await deliverTurnArtifactShares({
    conversationKey: input.conversationKey,
    publish: (path) =>
      input.client.publishProfileArtifactShare(input.profileId, path),
    // Raw: share tokens must not pass through markdown underscore stripping.
    sendFooter: (footer) => input.sendRaw(footer),
    session: input.session,
    sessionStore: input.sessionStore,
  });
}

async function sendArtifactDocumentForPath(input: {
  client: NakamaClient;
  profileId: string;
  path: string;
  filename: string;
  mimeType: string;
  sizeBytes?: number;
  socket: WASocket;
  jid: string;
  sendPlain: (text: string) => Promise<void>;
}): Promise<void> {
  if (
    typeof input.sizeBytes === "number" &&
    input.sizeBytes > WHATSAPP_ARTIFACT_DOCUMENT_MAX_BYTES
  ) {
    await input.sendPlain(formatWhatsAppArtifactOversizeError(input.sizeBytes));
    return;
  }

  try {
    const { contentType, data } = await input.client.readProfileArtifactContent(
      input.profileId,
      input.path
    );
    const result = await sendWhatsAppArtifactDocument(input.socket, input.jid, {
      bytes: new Uint8Array(data),
      filename: input.filename,
      mimeType:
        input.mimeType.trim() || contentType || "application/octet-stream",
    });

    if (!result.ok && result.error) {
      await input.sendPlain(result.error);
    }
  } catch (error) {
    await input.sendPlain(
      error instanceof Error
        ? error.message
        : "Failed to read the artifact for attachment."
    );
  }
}
