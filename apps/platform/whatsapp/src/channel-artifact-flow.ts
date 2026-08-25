import type { NakamaClient, RemoteChatSession } from "@nakama/client";
import {
  extractPairedTurnArtifacts,
  formatArtifactShareFooter,
  formatMissingAttachArtifactMessage,
  getMostRecentDeliverableArtifact,
  isAttachIntent,
  isAttachOnlyCommand,
  mintDeliverableArtifacts,
  pushDeliverableArtifact,
  resolveArtifactForAttach,
} from "@nakama/core";
import type { WASocket } from "@whiskeysockets/baileys";
import {
  sendWhatsAppArtifactDocument,
  WHATSAPP_ARTIFACT_DOCUMENT_MAX_BYTES,
} from "./send-artifact-document";
import type { SessionStore } from "./session-store";

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
}): Promise<void> {
  if (!isAttachIntent(input.attachUserText)) {
    return;
  }

  const artifact = getMostRecentDeliverableArtifact(
    input.sessionStore.getDeliverableArtifacts(input.conversationKey)
  );
  if (!artifact) {
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

/**
 * `/attach` shortcut: registry first, then newest listed profile artifact.
 * Always replies when nothing is available (unlike NL attach intent).
 */
export async function maybeSendWhatsAppAttachOnlyCommand(input: {
  client: NakamaClient;
  conversationKey: string;
  profileId: string;
  attachUserText: string;
  sessionStore: SessionStore;
  socket: WASocket;
  jid: string;
  sendPlain: (text: string) => Promise<void>;
}): Promise<boolean> {
  if (!isAttachOnlyCommand(input.attachUserText)) {
    return false;
  }

  const registry = input.sessionStore.getDeliverableArtifacts(
    input.conversationKey
  );
  let listed: Awaited<
    ReturnType<NakamaClient["listProfileArtifacts"]>
  >["artifacts"] = [];

  if (registry.length === 0) {
    try {
      const response = await input.client.listProfileArtifacts(input.profileId);
      listed = response.artifacts;
    } catch (error) {
      console.warn(
        "WhatsApp artifact list failed during /attach; cannot fall back to profile artifacts.",
        error instanceof Error ? error.message : error
      );
    }
  }

  const artifact = resolveArtifactForAttach({
    listed,
    registry,
  });

  if (!artifact) {
    await input.sendPlain(formatMissingAttachArtifactMessage());
    return true;
  }

  if (!registry.some((entry) => entry.path === artifact.path)) {
    const nextRegistry = pushDeliverableArtifact(registry, artifact);
    input.sessionStore.updateArtifactState(input.conversationKey, {
      deliverableArtifacts: nextRegistry,
    });
    await input.sessionStore.save();
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
    await input.sendPlain(
      `File is too large for WhatsApp attach (${formatMegabytes(input.sizeBytes)}; max ${formatMegabytes(WHATSAPP_ARTIFACT_DOCUMENT_MAX_BYTES)}). Use the share link instead.`
    );
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

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
