import type { ChannelArtifactRef } from "./channel-artifacts";

export interface DeliverableChannelArtifact extends ChannelArtifactRef {
  sharePath: string | null;
  shareUrl: string | null;
}

export interface PublishArtifactShareResult {
  refreshed: boolean;
  sharePath: string | null;
  shareUrl: string | null;
  webPublicUrlConfigured: boolean;
}

const ATTACH_NOUN =
  "file|document|attachment|artifact|pdf|csv|zip|image|photo|screenshot|report|deck";

/** Phrase matching for Telegram (and legacy callers). Discord natural-language
 * sends use the send_discord_artifact tool instead. */
const ATTACH_INTENT_PATTERNS = [
  new RegExp(
    String.raw`\b(?:send|attach|share)\s+(?:me\s+)?(?:the\s+)?(?:${ATTACH_NOUN})\b`,
    "i"
  ),
  new RegExp(
    String.raw`\b(?:download|get)\s+(?:me\s+)?(?:the\s+)?(?:${ATTACH_NOUN})\b`,
    "i"
  ),
  /\bsend\s+(?:me\s+)?(?:the\s+)?\S+\.(?:pdf|csv|png|jpe?g|gif|webp|zip|txt|md)\b/i,
  /\battach\s+it\b/i,
  /^\/attach(?:@\w+)?(?:\s|$)/i,
];

export interface ListedArtifactCandidate {
  /** Relative path under the profile artifacts dir (API read key). */
  filename: string;
  mimeType: string;
  sizeBytes: number;
  updatedAt: string;
}

export function isAttachIntent(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) {
    return false;
  }

  return ATTACH_INTENT_PATTERNS.some((pattern) => pattern.test(normalized));
}

/** Discord `/attach` shortcut (no agent turn). */
export function isAttachOnlyCommand(text: string): boolean {
  return /^\/attach(?:@\w+)?(?:\s|$)/i.test(text.trim());
}

/**
 * Resolve an artifact for the Discord `/attach` shortcut: session registry
 * first (most recent), then newest listed profile artifact.
 */
export function resolveArtifactForAttach(input: {
  listed: ListedArtifactCandidate[];
  registry: DeliverableChannelArtifact[];
}): DeliverableChannelArtifact | null {
  const fromRegistry = input.registry.at(-1);
  if (fromRegistry) {
    return fromRegistry;
  }

  const newestListed = input.listed[0];
  if (!newestListed) {
    return null;
  }

  return listedCandidateToDeliverable(newestListed);
}

export function formatMissingAttachArtifactMessage(): string {
  return "No saved artifact to attach. Ask me to send a file from Artifacts, or save one first.";
}

function listedCandidateToDeliverable(
  entry: ListedArtifactCandidate
): DeliverableChannelArtifact {
  const basename = entry.filename.split(/[\\/]/).pop() ?? entry.filename;
  return {
    filename: basename,
    mimeType: entry.mimeType,
    path: entry.filename,
    savedAt: entry.updatedAt,
    sharePath: null,
    shareUrl: null,
    sizeBytes: entry.sizeBytes,
  };
}

export function resolveShareUrlForPublish(
  response: PublishArtifactShareResult,
  cache: Record<string, string>,
  relativePath: string
): {
  shareUrl: string | null;
  sharePath: string | null;
  webPublicUrlConfigured: boolean;
} {
  if (response.shareUrl) {
    cache[relativePath] = response.shareUrl;
  }

  const shareUrl = response.shareUrl ?? cache[relativePath] ?? null;
  const sharePath =
    response.sharePath ||
    (shareUrl ? new URL(shareUrl, "http://localhost").pathname : null);

  return {
    sharePath,
    shareUrl,
    webPublicUrlConfigured: response.webPublicUrlConfigured,
  };
}

export function formatArtifactShareFooter(
  artifacts: Array<
    Pick<DeliverableChannelArtifact, "filename" | "shareUrl" | "sharePath">
  >,
  options: { webPublicUrlConfigured: boolean }
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
    lines.push(
      "Set Web Public URL in Nakama settings for absolute share links."
    );
  }

  return lines.join("\n");
}

export function pushDeliverableArtifact(
  registry: DeliverableChannelArtifact[],
  artifact: DeliverableChannelArtifact,
  maxEntries = 5
): DeliverableChannelArtifact[] {
  const withoutPath = registry.filter((entry) => entry.path !== artifact.path);
  const next = [...withoutPath, artifact];
  return next.slice(-maxEntries);
}

export function getMostRecentDeliverableArtifact(
  registry: DeliverableChannelArtifact[]
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
      const resolved = resolveShareUrlForPublish(
        response,
        input.shareUrlCache,
        artifact.path
      );

      delivered.push({
        ...artifact,
        sharePath: resolved.sharePath,
        shareUrl: resolved.shareUrl,
      });
    } catch {
      // Skip failed publishes; text reply still goes out.
    }
  }

  return delivered;
}
