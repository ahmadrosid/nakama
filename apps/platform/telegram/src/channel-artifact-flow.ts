import type { NakamaClient, RemoteChatSession } from "@nakama/client";
import {
  extractPairedTurnArtifacts,
  formatArtifactShareFooter,
  getMostRecentDeliverableArtifact,
  isAttachIntent,
  mintDeliverableArtifacts,
  pushDeliverableArtifact,
} from "@nakama/core";
import type { Context } from "grammy";
import type { TelegramRichMessenger } from "./rich-message";
import { sendTelegramArtifactDocument } from "./send-artifact-document";
import type { SessionStore } from "./session-store";

export async function maybeSendRequestedTelegramArtifactAttachment(input: {
  ctx: Context;
  client: NakamaClient;
  conversationKey: string;
  profileId: string;
  /** Raw user text before group-context prefixing. */
  attachUserText: string;
  sessionStore: SessionStore;
  messenger: TelegramRichMessenger;
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

  const { data } = await input.client.readProfileArtifactContent(
    input.profileId,
    artifact.path
  );
  const result = await sendTelegramArtifactDocument(input.ctx, {
    bytes: new Uint8Array(data),
    filename: artifact.filename,
  });

  if (!result.ok && result.error) {
    await input.messenger.sendPlain(result.error);
  }
}

export async function deliverTelegramTurnArtifactShares(input: {
  client: NakamaClient;
  session: RemoteChatSession;
  conversationKey: string;
  profileId: string;
  sessionStore: SessionStore;
  messenger: TelegramRichMessenger;
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
    await input.messenger.sendRaw(footer);
  }
}
