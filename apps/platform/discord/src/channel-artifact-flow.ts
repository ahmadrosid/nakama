import type { NakamaClient, RemoteChatSession } from "@nakama/client";
import {
  type DeliverableChannelArtifact,
  extractPairedTurnArtifacts,
  formatArtifactShareFooter,
  formatMissingAttachArtifactMessage,
  isAttachOnlyCommand,
  mintDeliverableArtifacts,
  pushDeliverableArtifact,
  resolveArtifactForAttach,
} from "@nakama/core";
import type { TextBasedChannel } from "discord.js";
import type { DiscordMessenger } from "./messenger";
import {
  DISCORD_ARTIFACT_ATTACHMENT_MAX_BYTES,
  sendDiscordArtifactAttachment,
} from "./send-artifact-attachment";
import type { SessionStore } from "./session-store";

export async function uploadDiscordArtifactFromToolResult(input: {
  channel: TextBasedChannel;
  client: NakamaClient;
  messenger: DiscordMessenger;
  profileId: string;
  result: unknown;
}): Promise<boolean> {
  const artifact = parseSendDiscordArtifactResult(input.result);
  if (!artifact) {
    return false;
  }

  try {
    const { data } = await input.client.readProfileArtifactContent(
      input.profileId,
      artifact.path
    );
    const result = await sendDiscordArtifactAttachment(input.channel, {
      bytes: new Uint8Array(data),
      filename: artifact.filename,
      mimeType: artifact.mimeType,
    });

    if (!result.ok && result.error) {
      await input.messenger.send(result.error);
      return false;
    }

    return result.ok;
  } catch (error) {
    await input.messenger.send(
      error instanceof Error
        ? error.message
        : "Failed to read the artifact for attachment."
    );
    return false;
  }
}

function parseSendDiscordArtifactResult(result: unknown): {
  filename: string;
  mimeType: string;
  path: string;
} | null {
  if (typeof result !== "object" || result === null) {
    return null;
  }

  const record = result as Record<string, unknown>;
  if (record.ok !== true) {
    return null;
  }

  if (
    typeof record.path !== "string" ||
    typeof record.filename !== "string" ||
    typeof record.mimeType !== "string"
  ) {
    return null;
  }

  return {
    filename: record.filename,
    mimeType: record.mimeType,
    path: record.path,
  };
}

export async function maybeSendRequestedDiscordArtifactAttachment(input: {
  channel: TextBasedChannel;
  client: NakamaClient;
  conversationKey: string;
  profileId: string;
  /** Raw user text before group-context prefixing. */
  attachUserText: string;
  sessionStore: SessionStore;
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

  try {
    const { data } = await input.client.readProfileArtifactContent(
      input.profileId,
      artifact.path
    );
    const result = await sendDiscordArtifactAttachment(input.channel, {
      bytes: new Uint8Array(data),
      filename: artifact.filename,
      mimeType: artifact.mimeType,
    });

    if (!result.ok && result.error) {
      await input.messenger.send(result.error);
      return false;
    }

    return result.ok;
  } catch (error) {
    await input.messenger.send(
      error instanceof Error
        ? error.message
        : "Failed to read the artifact for attachment."
    );
    return false;
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

  let nextRegistry = input.sessionStore.getDeliverableArtifacts(
    input.conversationKey
  );
  for (const artifact of delivered) {
    nextRegistry = pushDeliverableArtifact(nextRegistry, artifact);
  }

  input.sessionStore.updateArtifactState(input.conversationKey, {
    artifactShareUrls: shareUrlCache,
    deliverableArtifacts: nextRegistry,
  });
  await input.sessionStore.save();

  for (const artifact of delivered) {
    await tryUploadDiscordArtifact({
      artifact,
      channel: input.channel,
      client: input.client,
      profileId: input.profileId,
    });
  }

  // Always post share links (like Telegram); attachment upload is additive.
  const footer = formatArtifactShareFooter(delivered, {
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
    const { data } = await input.client.readProfileArtifactContent(
      input.profileId,
      input.artifact.path
    );
    const bytes = new Uint8Array(data);
    if (bytes.byteLength > DISCORD_ARTIFACT_ATTACHMENT_MAX_BYTES) {
      return false;
    }

    const result = await sendDiscordArtifactAttachment(input.channel, {
      bytes,
      filename: input.artifact.filename,
      mimeType: input.artifact.mimeType,
    });

    if (!result.ok) {
      console.warn(
        `Discord artifact upload failed for ${input.artifact.filename}; falling back to share link.`,
        result.error ?? "unknown error"
      );
    }

    return result.ok;
  } catch (error) {
    console.warn(
      `Discord artifact upload failed for ${input.artifact.filename}; falling back to share link.`,
      error instanceof Error ? error.message : error
    );
    return false;
  }
}
