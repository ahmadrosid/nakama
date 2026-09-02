import type { NakamaClient, RemoteChatSession } from "@nakama/client";
import {
  deliverTurnArtifactShares,
  getMostRecentDeliverableArtifact,
  isAttachIntent,
} from "@nakama/core";
import type { ChannelSessionStore } from "@nakama/core/channel-session-store";
import type { Context } from "grammy";
import type { TelegramRichMessenger } from "./rich-message";
import { sendTelegramArtifactDocument } from "./send-artifact-document";

export async function maybeSendRequestedTelegramArtifactAttachment(input: {
  ctx: Context;
  client: NakamaClient;
  conversationKey: string;
  profileId: string;
  /** Raw user text before group-context prefixing. */
  attachUserText: string;
  sessionStore: ChannelSessionStore;
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
  sessionStore: ChannelSessionStore;
  messenger: TelegramRichMessenger;
}): Promise<void> {
  await deliverTurnArtifactShares({
    conversationKey: input.conversationKey,
    publish: (path) =>
      input.client.publishProfileArtifactShare(input.profileId, path),
    // Raw: share tokens must not pass through markdown underscore stripping.
    sendFooter: (footer) => input.messenger.sendRaw(footer),
    session: input.session,
    sessionStore: input.sessionStore,
  });
}
