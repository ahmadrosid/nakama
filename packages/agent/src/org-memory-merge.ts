import {
  applyApprovedOrgMemoryBullet,
  normalizeOrgMemoryDedupKey,
  type ProviderClient,
  parseOrgMemoryContent,
  rebuildOrgMemoryContent,
} from "@nakama/core";

const ORG_MEMORY_MERGE_SYSTEM = [
  "You maintain an organization's shared MEMORY.md file.",
  "Given the current file and one newly approved fact, return the updated MEMORY.md.",
  "",
  "Rules:",
  "- Keep the structure: `## Org Memory`, optional `## Pinned`, and dated `## YYYY-MM-DD` sections.",
  "- Place the new fact in the pinned section when pin=true, otherwise under today's dated section.",
  "- Replace stale facts that the new fact supersedes instead of keeping contradictory duplicates.",
  "- Preserve unrelated facts verbatim.",
  "- Return only the markdown file content. No commentary or code fences.",
].join("\n");

export interface MergeOrgMemoryWithApprovedBulletOptions {
  dateUtc?: string;
  pin?: boolean;
  provider?: ProviderClient;
}

function buildOrgMemoryMergePrompt(
  content: string,
  bullet: string,
  options: { pin: boolean; dateUtc: string }
): string {
  return [
    "Current MEMORY.md:",
    content.trim().length > 0 ? content.trim() : "## Org Memory\n\n## Pinned",
    "",
    `New approved fact: ${bullet.trim()}`,
    `Destination: ${options.pin ? "pinned" : `recent log (${options.dateUtc})`}`,
    `Today's UTC date section (when not pinned): ${options.dateUtc}`,
  ].join("\n");
}

function normalizeMergedOrgMemoryContent(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const withoutFences = trimmed
    .replace(/^```(?:markdown|md)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  if (!withoutFences.includes("## Org Memory")) {
    return null;
  }

  return rebuildOrgMemoryContent(parseOrgMemoryContent(withoutFences));
}

function mergedContentIncludesBullet(content: string, bullet: string): boolean {
  const parsed = parseOrgMemoryContent(content);
  const dedupKey = normalizeOrgMemoryDedupKey(bullet);
  return (
    parsed.pinned.some(
      (entry) => normalizeOrgMemoryDedupKey(entry) === dedupKey
    ) ||
    parsed.sections.some((section) =>
      section.bullets.some(
        (entry) => normalizeOrgMemoryDedupKey(entry) === dedupKey
      )
    )
  );
}

export async function mergeOrgMemoryWithApprovedBullet(
  content: string,
  bullet: string,
  options: MergeOrgMemoryWithApprovedBulletOptions = {}
): Promise<string | null> {
  const pin = options.pin ?? false;
  const dateUtc = options.dateUtc ?? new Date().toISOString().slice(0, 10);
  const provider = options.provider;

  if (!provider) {
    return null;
  }

  try {
    const result = await provider.generateText({
      format: "text",
      prompt: buildOrgMemoryMergePrompt(content, bullet, { dateUtc, pin }),
      system: ORG_MEMORY_MERGE_SYSTEM,
    });

    const merged = normalizeMergedOrgMemoryContent(result.content);
    if (!(merged && mergedContentIncludesBullet(merged, bullet))) {
      return null;
    }

    return merged;
  } catch (error) {
    console.error("Failed to merge org memory with provider:", error);
    return null;
  }
}

export function mergeOrgMemoryWithApprovedBulletFallback(
  content: string,
  bullet: string,
  options: MergeOrgMemoryWithApprovedBulletOptions = {}
): string {
  return applyApprovedOrgMemoryBullet(content, bullet, {
    dateUtc: options.dateUtc,
    pin: options.pin,
  });
}
