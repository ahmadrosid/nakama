/**
 * Pure parse/summary helpers for org `MEMORY.md`.
 *
 * No disk I/O lives here — callers hand in the file content and write the
 * rebuilt string back out themselves. This keeps the helpers trivially
 * testable and lets the service layer own all filesystem access.
 */

import type { MemorySection } from "./memory-archive";

export const ORG_MEMORY_HEADER = "## Org Memory";

export const ORG_MEMORY_PREAMBLE = `${ORG_MEMORY_HEADER}

## Pinned`;

export interface ParsedOrgMemory {
  preamble: string;
  pinned: string[];
  sections: MemorySection[];
}

export function normalizeOrgMemoryDedupKey(bullet: string): string {
  return bullet.trim().replace(/^-\s+/, "").trim().toLowerCase();
}

export function detectOrgMemoryInjectionWarnings(bullet: string): string[] {
  const warnings: string[] = [];
  if (/ignore (all )?previous/i.test(bullet)) {
    warnings.push("Contains instruction-like phrasing.");
  }
  if (/^system:/im.test(bullet)) {
    warnings.push("Contains a system-style prefix.");
  }
  if (/^##\s/m.test(bullet)) {
    warnings.push("Contains markdown headings.");
  }
  if (/<\/?[a-z][\s\S]*>/i.test(bullet)) {
    warnings.push("Contains HTML-like markup.");
  }
  return warnings;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function parseOrgMemoryContent(content?: string | null): ParsedOrgMemory {
  const lines = (content ?? "").split("\n");
  const preambleLines: string[] = [];
  const pinned: string[] = [];
  const sections: MemorySection[] = [];
  let phase: "preamble" | "pinned" | "dated" = "preamble";
  let currentDate: string | null = null;
  let currentBullets: string[] = [];

  const flushSection = () => {
    if (currentDate) {
      sections.push({ date: currentDate, bullets: currentBullets });
    }
    currentDate = null;
    currentBullets = [];
  };

  for (const line of lines) {
    if (line.match(/^## Pinned$/)) {
      if (phase === "dated") {
        flushSection();
      }
      phase = "pinned";
      continue;
    }

    const dateMatch = line.match(/^## (\d{4}-\d{2}-\d{2})$/);
    if (dateMatch) {
      if (phase === "dated") {
        flushSection();
      }
      phase = "dated";
      currentDate = dateMatch[1];
      currentBullets = [];
      continue;
    }

    if (phase === "preamble") {
      preambleLines.push(line);
      continue;
    }

    if (line.startsWith("- ")) {
      if (phase === "pinned") {
        pinned.push(line.slice(2));
      } else if (phase === "dated") {
        currentBullets.push(line.slice(2));
      }
    }
  }

  if (phase === "dated") {
    flushSection();
  }

  return normalizeParsedOrgMemory({
    preamble: preambleLines.join("\n").replace(/\n+$/, ""),
    pinned,
    sections,
  });
}

function stripPinnedHeaderFromPreamble(preamble: string): string {
  return preamble
    .split("\n")
    .filter((line) => !/^## Pinned\s*$/.test(line.trim()))
    .join("\n")
    .replace(/\n+$/, "")
    .trim();
}

/** Normalize malformed MEMORY.md content before rebuild or merge. */
export function normalizeParsedOrgMemory(parsed: ParsedOrgMemory): ParsedOrgMemory {
  const preambleLines: string[] = [];
  const rescuedPinned: string[] = [];

  for (const line of parsed.preamble.split("\n")) {
    if (line.startsWith("- ")) {
      rescuedPinned.push(line.slice(2));
      continue;
    }
    preambleLines.push(line);
  }

  return {
    preamble: stripPinnedHeaderFromPreamble(preambleLines.join("\n")),
    pinned: [...parsed.pinned, ...rescuedPinned],
    sections: parsed.sections,
  };
}

export function rebuildOrgMemoryContent(parsed: ParsedOrgMemory): string {
  const normalized = normalizeParsedOrgMemory(parsed);
  const parts: string[] = [];

  const preamble = normalized.preamble.trim();
  parts.push(preamble.length > 0 ? preamble : ORG_MEMORY_HEADER);

  if (normalized.pinned.length > 0) {
    parts.push("", "## Pinned", "");
    for (const bullet of normalized.pinned) {
      parts.push(`- ${bullet}`);
    }
  } else if (normalized.sections.length === 0) {
    parts.push("", "## Pinned", "");
  }

  for (const section of normalized.sections) {
    if (section.bullets.length === 0) {
      continue;
    }
    parts.push("", `## ${section.date}`, "");
    for (const bullet of section.bullets) {
      parts.push(`- ${bullet}`);
    }
  }

  const content = parts.join("\n").replace(/\n+$/, "");
  return content.length > 0 ? `${content}\n` : content;
}

const ORG_MEMORY_SUPERSEDE_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "at",
  "for",
  "in",
  "is",
  "of",
  "on",
  "or",
  "our",
  "team",
  "the",
  "to",
  "we",
]);

function significantOrgMemoryTokens(bullet: string): string[] {
  return bullet
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !ORG_MEMORY_SUPERSEDE_STOP_WORDS.has(token));
}

function orgMemorySupersessionScore(existingBullet: string, newBullet: string): number {
  const existingTokens = significantOrgMemoryTokens(existingBullet);
  const newTokens = significantOrgMemoryTokens(newBullet);
  if (existingTokens.length < 2 || newTokens.length < 2) {
    return 0;
  }

  const shared = newTokens.filter((token) => existingTokens.includes(token));
  return shared.length / Math.min(existingTokens.length, newTokens.length);
}

function removeOrgMemoryBullet(
  parsed: ParsedOrgMemory,
  predicate: (bullet: string) => boolean,
): void {
  parsed.pinned = parsed.pinned.filter((bullet) => !predicate(bullet));
  for (const section of parsed.sections) {
    section.bullets = section.bullets.filter((bullet) => !predicate(bullet));
  }
}

function removeSupersededOrgMemoryBullets(parsed: ParsedOrgMemory, newBullet: string): void {
  const newKey = normalizeOrgMemoryDedupKey(newBullet);
  removeOrgMemoryBullet(parsed, (bullet) => {
    if (normalizeOrgMemoryDedupKey(bullet) === newKey) {
      return false;
    }
    return orgMemorySupersessionScore(bullet, newBullet) >= 0.65;
  });
}

export interface ApplyApprovedOrgMemoryBulletOptions {
  pin?: boolean;
  dateUtc?: string;
}

/** Apply an approved proposal bullet to live org memory content. */
export function applyApprovedOrgMemoryBullet(
  content: string | null | undefined,
  bullet: string,
  options: ApplyApprovedOrgMemoryBulletOptions = {},
): string {
  const pin = options.pin ?? false;
  const dateUtc = options.dateUtc ?? new Date().toISOString().slice(0, 10);
  const text = bullet.trim().replace(/^-\s+/, "").trim();
  const parsed = normalizeParsedOrgMemory(parseOrgMemoryContent(content ?? ""));
  const dedupKey = normalizeOrgMemoryDedupKey(text);

  removeOrgMemoryBullet(parsed, (entry) => normalizeOrgMemoryDedupKey(entry) === dedupKey);
  removeSupersededOrgMemoryBullets(parsed, text);

  const alreadyPresent =
    parsed.pinned.some((entry) => normalizeOrgMemoryDedupKey(entry) === dedupKey) ||
    parsed.sections.some((section) =>
      section.bullets.some((entry) => normalizeOrgMemoryDedupKey(entry) === dedupKey),
    );

  if (!alreadyPresent) {
    if (pin) {
      parsed.pinned.push(text);
    } else {
      let section = parsed.sections.find((entry) => entry.date === dateUtc);
      if (!section) {
        section = { date: dateUtc, bullets: [] };
        parsed.sections.push(section);
        parsed.sections.sort((a, b) => a.date.localeCompare(b.date));
      }
      section.bullets.push(text);
    }
  }

  return rebuildOrgMemoryContent(parsed);
}

export function collectRecentLogBullets(
  sections: MemorySection[],
  limit: number,
): string[] {
  if (limit <= 0) {
    return [];
  }

  const sorted = [...sections].sort((a, b) => b.date.localeCompare(a.date));
  const collected: string[] = [];

  for (const section of sorted) {
    for (let index = section.bullets.length - 1; index >= 0; index -= 1) {
      collected.push(section.bullets[index]);
      if (collected.length >= limit) {
        return collected;
      }
    }
  }

  return collected;
}

export interface OrgMemorySummaryOptions {
  /** Hard byte cap on the rendered summary. Defaults to 2048. */
  byteCap?: number;
  /** Most recent log bullets to include after pinned. Defaults to 20. */
  recentLogLimit?: number;
  /** Hint shown when the summary is truncated. */
  overflowHint?: string;
}

/**
 * Append the org memory section to a system prompt, gated by org role.
 * Viewers never receive the section; everyone else gets it appended when
 * non-empty. Returns the unchanged `systemPrompt` when the section is empty
 * or the role is viewer.
 */
export function appendOrgMemorySection(
  systemPrompt: string,
  summary: string,
  orgRole?: string | null,
): string {
  if (orgRole === "viewer") {
    return systemPrompt;
  }
  const trimmed = summary.trim();
  if (trimmed.length === 0) {
    return systemPrompt;
  }
  return `${systemPrompt.trim()}\n\n${trimmed}`;
}

/**
 * Render the `## Org Memory` section string injected into a profile's system
 * prompt. Includes pinned bullets first, then the N most recent log bullets.
 * When the rendered section exceeds `byteCap`, bullets are dropped from the
 * end and an overflow hint is appended pointing the agent at
 * `org_memory_search`.
 */
export interface OrgMemoryApprovePreview {
  destination: "pinned" | "recent-log";
  destinationLabel: string;
  memoryLine: string;
  promptInjection: string;
}

/** Simulate approveProposal writes for admin UI previews. */
export function previewOrgMemoryAfterApprove(
  liveContent: string | null | undefined,
  bullet: string,
  options: { pin?: boolean; byteCap?: number; recentLogLimit?: number; dateUtc?: string } = {},
): OrgMemoryApprovePreview {
  const pin = options.pin ?? false;
  const dateUtc = options.dateUtc ?? new Date().toISOString().slice(0, 10);
  const text = bullet.trim().replace(/^-\s+/, "").trim();
  const rebuilt = applyApprovedOrgMemoryBullet(liveContent, bullet, { pin, dateUtc });
  const promptInjection = composeOrgMemorySummary(rebuilt, {
    byteCap: options.byteCap ?? 2048,
    recentLogLimit: options.recentLogLimit ?? 20,
  });

  return {
    destination: pin ? "pinned" : "recent-log",
    destinationLabel: pin ? "## Pinned" : `## ${dateUtc}`,
    memoryLine: `- ${text}`,
    promptInjection,
  };
}

export function composeOrgMemorySummary(
  content?: string | null,
  options: OrgMemorySummaryOptions = {},
): string {
  const {
    byteCap = 2048,
    recentLogLimit = 20,
    overflowHint = "Use the org_memory_search tool for the full history.",
  } = options;
  const parsed = parseOrgMemoryContent(content);
  const recentBullets = collectRecentLogBullets(parsed.sections, recentLogLimit);
  const bullets = [...parsed.pinned, ...recentBullets];

  if (bullets.length === 0) {
    return "";
  }

  const header = "## Org Memory";
  const lines: string[] = [header, ""];

  let bytes = utf8ByteLength(`${lines.join("\n")}\n`);
  let included = 0;

  for (const bullet of bullets) {
    const candidate = `- ${bullet}`;
    const candidateBytes = utf8ByteLength(`${candidate}\n`);
    if (bytes + candidateBytes > byteCap) {
      break;
    }
    lines.push(candidate);
    bytes += candidateBytes;
    included += 1;
  }

  if (included === 0) {
    return `${header}\n\n- ${overflowHint}\n`;
  }

  if (included < bullets.length) {
    lines.push("", `- ${overflowHint}`);
  }

  return lines.join("\n");
}
