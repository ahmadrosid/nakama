import type { NakamaClient, RemoteChatSession } from "@nakama/client";
import {
  extractPairedTurnArtifacts,
  formatArtifactShareFooter,
  formatMissingAttachArtifactMessage,
  getMostRecentDeliverableArtifact,
  isAttachIntent,
  mintDeliverableArtifacts,
  pushDeliverableArtifact,
} from "@nakama/core";
import type { WASocket } from "@whiskeysockets/baileys";
import {
  formatWhatsAppArtifactOversizeError,
  sendWhatsAppArtifactDocument,
  WHATSAPP_ARTIFACT_DOCUMENT_MAX_BYTES,
} from "./send-artifact-document";
import type { SessionStore } from "./session-store";

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
  sessionStore: SessionStore;
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
  sessionStore: SessionStore;
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
  sessionStore: SessionStore;
  sendRaw: (text: string) => Promise<void>;
}): Promise<void> {
  const messages = await input.session.getMessages();
  const paired = extractPairedTurnArtifacts(messages);
  if (paired.length === 0) {
    return;
  }

  const shareUrlCache = input.sessionStore.getArtifactShareUrls(
    input.conversationKey
  );
  let webPublicUrlConfigured = true;
  const delivered = await mintDeliverableArtifacts({
    artifacts: paired,
    publish: async (path) => {
      const response = await input.client.publishProfileArtifactShare(
        input.profileId,
        path
      );
      webPublicUrlConfigured = response.webPublicUrlConfigured;
      return response;
    },
    shareUrlCache,
  });

  if (delivered.length === 0) {
    return;
  }

  let registry = input.sessionStore.getDeliverableArtifacts(
    input.conversationKey
  );
  for (const artifact of delivered) {
    registry = pushDeliverableArtifact(registry, artifact);
  }

  input.sessionStore.updateArtifactState(input.conversationKey, {
    artifactShareUrls: shareUrlCache,
    deliverableArtifacts: registry,
  });
  await input.sessionStore.save();

  const footer = formatArtifactShareFooter(delivered, {
    webPublicUrlConfigured,
  });

  if (footer.trim()) {
    // Raw: share tokens must not pass through markdown underscore stripping.
    await input.sendRaw(footer);
  }
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
