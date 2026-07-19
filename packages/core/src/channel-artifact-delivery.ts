import type { ChannelArtifactRef } from "./channel-artifacts";

export interface DeliverableChannelArtifact extends ChannelArtifactRef {
  shareUrl: string | null;
  sharePath: string | null;
}

export interface PublishArtifactShareResult {
  shareUrl: string | null;
  sharePath: string | null;
  webPublicUrlConfigured: boolean;
  refreshed: boolean;
}

const ATTACH_INTENT_PATTERNS = [
  /\b(?:send|attach|share)\s+(?:me\s+)?(?:the\s+)?(?:file|document|attachment|artifact)\b/i,
  /\b(?:download|get)\s+(?:me\s+)?(?:the\s+)?(?:file|document|attachment|artifact)\b/i,
  /\battach\s+it\b/i,
  /^\/attach(?:@\w+)?(?:\s|$)/i,
];

export function isAttachIntent(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) {
    return false;
  }

  return ATTACH_INTENT_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function resolveShareUrlForPublish(
  response: PublishArtifactShareResult,
  cache: Record<string, string>,
  relativePath: string,
): { shareUrl: string | null; sharePath: string | null; webPublicUrlConfigured: boolean } {
  if (response.shareUrl) {
    cache[relativePath] = response.shareUrl;
  }

  const shareUrl = response.shareUrl ?? cache[relativePath] ?? null;
  const sharePath = response.sharePath || (shareUrl ? new URL(shareUrl, "http://localhost").pathname : null);

  return {
    shareUrl,
    sharePath,
    webPublicUrlConfigured: response.webPublicUrlConfigured,
  };
}

export function formatArtifactShareFooter(
  artifacts: Array<Pick<DeliverableChannelArtifact, "filename" | "shareUrl" | "sharePath">>,
  options: { webPublicUrlConfigured: boolean },
): string {
  const lines: string[] = [];

  for (const artifact of artifacts) {
    const link = artifact.shareUrl ?? artifact.sharePath;
    if (!link) {
      continue;
    }

    lines.push(`${artifact.filename}: ${link}`);
  }

  if (lines.length === 0) {
    return "";
  }

  if (!options.webPublicUrlConfigured) {
    lines.push("Set Web Public URL in Nakama settings for absolute share links.");
  }

  return lines.join("\n");
}

export function pushDeliverableArtifact(
  registry: DeliverableChannelArtifact[],
  artifact: DeliverableChannelArtifact,
  maxEntries = 5,
): DeliverableChannelArtifact[] {
  const withoutPath = registry.filter((entry) => entry.path !== artifact.path);
  const next = [...withoutPath, artifact];
  return next.slice(-maxEntries);
}

export function getMostRecentDeliverableArtifact(
  registry: DeliverableChannelArtifact[],
): DeliverableChannelArtifact | null {
  return registry.at(-1) ?? null;
}

export async function mintDeliverableArtifacts(input: {
  artifacts: ChannelArtifactRef[];
  shareUrlCache: Record<string, string>;
  publish: (relativePath: string) => Promise<PublishArtifactShareResult>;
}): Promise<DeliverableChannelArtifact[]> {
  const delivered: DeliverableChannelArtifact[] = [];

  for (const artifact of input.artifacts) {
    try {
      const response = await input.publish(artifact.path);
      const resolved = resolveShareUrlForPublish(response, input.shareUrlCache, artifact.path);

      delivered.push({
        ...artifact,
        shareUrl: resolved.shareUrl,
        sharePath: resolved.sharePath,
      });
    } catch {
      // Skip failed publishes; text reply still goes out.
    }
  }

  return delivered;
}
