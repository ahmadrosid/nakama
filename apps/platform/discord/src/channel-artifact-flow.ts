import type { NakamaClient, RemoteChatSession } from "@nakama/client";
import {
  extractPairedTurnArtifacts,
  formatArtifactShareFooter,
  getMostRecentDeliverableArtifact,
  isAttachIntent,
  mintDeliverableArtifacts,
  pushDeliverableArtifact,
  type DeliverableChannelArtifact,
} from "@nakama/core";
import type { TextBasedChannel } from "discord.js";
import type { SessionStore } from "./session-store";
import {
  DISCORD_ARTIFACT_ATTACHMENT_MAX_BYTES,
  sendDiscordArtifactAttachment,
} from "./send-artifact-attachment";
import type { DiscordMessenger } from "./messenger";

export async function maybeSendRequestedDiscordArtifactAttachment(input: {
  channel: TextBasedChannel;
  client: NakamaClient;
  conversationKey: string;
  profileId: string;
  /** Raw user text before group-context prefixing. */
  attachUserText: string;
  sessionStore: SessionStore;
  messenger: DiscordMessenger;
}): Promise<void> {
  if (!isAttachIntent(input.attachUserText)) {
    return;
  }

  const artifact = getMostRecentDeliverableArtifact(input.sessionStore.getDeliverableArtifacts(input.conversationKey));
  if (!artifact) {
    return;
  }

  const { data } = await input.client.readProfileArtifactContent(input.profileId, artifact.path);
  const result = await sendDiscordArtifactAttachment(input.channel, {
    filename: artifact.filename,
    bytes: new Uint8Array(data),
  });

  if (!result.ok && result.error) {
    await input.messenger.send(result.error);
  }
}

export async function deliverDiscordTurnArtifactShares(input: {
  channel: TextBasedChannel;
  client: NakamaClient;
  session: RemoteChatSession;
  conversationKey: string;
  profileId: string;
  sessionStore: SessionStore;
  messenger: DiscordMessenger;
}): Promise<void> {
  const messages = await input.session.getMessages();
  const paired = extractPairedTurnArtifacts(messages);
  if (paired.length === 0) {
    return;
  }

  const shareUrlCache = input.sessionStore.getArtifactShareUrls(input.conversationKey);
  let webPublicUrlConfigured = true;
  const delivered = await mintDeliverableArtifacts({
    artifacts: paired,
    shareUrlCache,
    publish: async (path) => {
      const response = await input.client.publishProfileArtifactShare(input.profileId, path);
      webPublicUrlConfigured = response.webPublicUrlConfigured;
      return response;
    },
  });

  if (delivered.length === 0) {
    return;
  }

  let registry = input.sessionStore.getDeliverableArtifacts(input.conversationKey);
  for (const artifact of delivered) {
    registry = pushDeliverableArtifact(registry, artifact);
  }

  input.sessionStore.updateArtifactState(input.conversationKey, {
    artifactShareUrls: shareUrlCache,
    deliverableArtifacts: registry,
  });
  await input.sessionStore.save();

  const fallbackArtifacts: DeliverableChannelArtifact[] = [];

  for (const artifact of delivered) {
    const uploaded = await tryUploadDiscordArtifact({
      channel: input.channel,
      client: input.client,
      profileId: input.profileId,
      artifact,
    });

    if (!uploaded) {
      fallbackArtifacts.push(artifact);
    }
  }

  const footer = formatArtifactShareFooter(fallbackArtifacts, {
    webPublicUrlConfigured,
  });

  if (footer.trim()) {
    await input.messenger.send(footer);
  }
}

async function tryUploadDiscordArtifact(input: {
  channel: TextBasedChannel;
  client: NakamaClient;
  profileId: string;
  artifact: DeliverableChannelArtifact;
}): Promise<boolean> {
  if (input.artifact.sizeBytes > DISCORD_ARTIFACT_ATTACHMENT_MAX_BYTES) {
    return false;
  }

  try {
    const { data } = await input.client.readProfileArtifactContent(input.profileId, input.artifact.path);
    const bytes = new Uint8Array(data);
    if (bytes.byteLength > DISCORD_ARTIFACT_ATTACHMENT_MAX_BYTES) {
      return false;
    }

    const result = await sendDiscordArtifactAttachment(input.channel, {
      filename: input.artifact.filename,
      bytes,
    });

    return result.ok;
  } catch {
    return false;
  }
}
