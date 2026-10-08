import type { NakamaClient, RemoteChatSession } from "@nakama/client";
import {
  type DeliverableChannelArtifact,
  deliverTurnArtifactShares,
  formatMissingAttachArtifactMessage,
  isAttachOnlyCommand,
  pushDeliverableArtifact,
  resolveArtifactForAttach,
} from "@nakama/core";
import type { ChannelSessionStore } from "@nakama/core/channel-session-store";
import { DISCORD_ARTIFACT_ATTACHMENT_MAX_BYTES } from "@nakama/core/discord-attachment";
import type { TextBasedChannel } from "discord.js";
import { z } from "zod";
import type { DiscordMessenger } from "./messenger";
import { sendDiscordArtifactAttachment } from "./send-artifact-attachment";

async function uploadArtifactBytes(input: {
  channel: TextBasedChannel;
  client: NakamaClient;
  profileId: string;
  path: string;
  filename: string;
  mimeType: string;
  onError?: (message: string) => Promise<void>;
}): Promise<boolean> {
  try {
    const { data } = await input.client.readProfileArtifactContent(
      input.profileId,
      input.path
    );

    const result = await sendDiscordArtifactAttachment(input.channel, {
      bytes: new Uint8Array(data),
      filename: input.filename,
      mimeType: input.mimeType,
    });

    if (!result.ok && result.error) {
      await input.onError?.(result.error);
    }

    return result.ok;
  } catch (error) {
    await input.onError?.(
      error instanceof Error
        ? error.message
        : "Failed to read the artifact for attachment."
    );

    return false;
  }
}

export async function uploadDiscordArtifactFromToolResult(input: {
  channel: TextBasedChannel;
  client: NakamaClient;
  messenger: DiscordMessenger;
  profileId: string;
  result: unknown;
}): Promise<boolean> {
  const parsedResult = z
    .object({
      filename: z.string(),
      mimeType: z.string(),
      ok: z.literal(true),
      path: z.string(),
    })
    .safeParse(input.result);

  if (!parsedResult.success) {
    return false;
  }

  const artifact = parsedResult.data;

  return uploadArtifactBytes({
    channel: input.channel,
    client: input.client,
    filename: artifact.filename,
    mimeType: artifact.mimeType,
    onError: (message) => input.messenger.send(message).then(() => undefined),
    path: artifact.path,
    profileId: input.profileId,
  });
}

export async function maybeSendRequestedDiscordArtifactAttachment(input: {
  channel: TextBasedChannel;
  client: NakamaClient;
  conversationKey: string;
  profileId: string;
  /** Raw user text before group-context prefixing. */
  attachUserText: string;
  sessionStore: ChannelSessionStore;
  messenger: DiscordMessenger;
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
        "Discord artifact list failed during /attach; cannot fall back to profile artifacts.",
        error instanceof Error ? error.message : error
      );
    }
  }

  const artifact = resolveArtifactForAttach({
    listed,
    registry,
  });

  if (!artifact) {
    await input.messenger.send(formatMissingAttachArtifactMessage());

    return false;
  }

  if (!registry.some((entry) => entry.path === artifact.path)) {
    const nextRegistry = pushDeliverableArtifact(registry, artifact);
    input.sessionStore.updateArtifactState(input.conversationKey, {
      deliverableArtifacts: nextRegistry,
    });
    await input.sessionStore.save();
  }

  return uploadArtifactBytes({
    channel: input.channel,
    client: input.client,
    filename: artifact.filename,
    mimeType: artifact.mimeType,
    onError: (message) => input.messenger.send(message).then(() => undefined),
    path: artifact.path,
    profileId: input.profileId,
  });
}

export async function deliverDiscordTurnArtifactShares(input: {
  channel: TextBasedChannel;
  client: NakamaClient;
  session: RemoteChatSession;
  conversationKey: string;
  profileId: string;
  sessionStore: ChannelSessionStore;
  messenger: DiscordMessenger;
}): Promise<void> {
  await deliverTurnArtifactShares({
    afterMinted: async (delivered) => {
      for (const artifact of delivered) {
        await tryUploadDiscordArtifact({
          artifact,
          channel: input.channel,
          client: input.client,
          profileId: input.profileId,
        });
      }
    },
    conversationKey: input.conversationKey,
    publish: (path) =>
      input.client.publishProfileArtifactShare(input.profileId, path),
    sendFooter: (footer) => input.messenger.send(footer),
    session: input.session,
    sessionStore: input.sessionStore,
  });
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

  const ok = await uploadArtifactBytes({
    channel: input.channel,
    client: input.client,
    filename: input.artifact.filename,
    mimeType: input.artifact.mimeType,
    path: input.artifact.path,
    profileId: input.profileId,
  });

  if (!ok) {
    console.warn(
      `Discord artifact upload failed for ${input.artifact.filename}; falling back to share link.`
    );
  }

  return ok;
}
