import { join } from "node:path";
import { pathExists, readText, readTextIfExists, writePrivateTextFile } from "../fs";
import {
  formatMemoryArchiveYearMonth,
  getMemoryArchiveFilePath,
} from "./memory-paths";
import { getProfileSoulDir } from "./resolve";

export const MEMORY_ARCHIVE_TEMPLATE = `# Archived Memory

---
`;

export interface MemorySection {
  date: string;
  bullets: string[];
}

export interface ParsedMemory {
  preamble: string;
  sections: MemorySection[];
}

export interface ArchiveMemoryResult {
  archived: number;
  activeBytes: number;
  archivePath: string;
}

export function parseMemoryContent(content: string): ParsedMemory {
  const lines = content.split("\n");
  const preambleLines: string[] = [];
  const sections: MemorySection[] = [];
  let currentDate: string | null = null;
  let currentBullets: string[] = [];
  let phase: "preamble" | "sections" = "preamble";

  for (const line of lines) {
    const dateMatch = line.match(/^## (\d{4}-\d{2}-\d{2})$/);
    if (dateMatch) {
      if (currentDate) {
        sections.push({ date: currentDate, bullets: currentBullets });
      }
      phase = "sections";
      currentDate = dateMatch[1];
      currentBullets = [];
      continue;
    }

    if (phase === "preamble") {
      preambleLines.push(line);
      continue;
    }

    if (line.startsWith("- ")) {
      currentBullets.push(line.slice(2));
    }
  }

  if (currentDate) {
    sections.push({ date: currentDate, bullets: currentBullets });
  }

  return {
    preamble: preambleLines.join("\n").replace(/\n+$/, ""),
    sections,
  };
}

export function rebuildMemoryContent(parsed: ParsedMemory): string {
  const parts = [parsed.preamble];

  for (const section of parsed.sections) {
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

export function partitionMemoryEntries(
  parsed: ParsedMemory,
  entries: string[],
): {
  active: ParsedMemory;
  archivedSections: MemorySection[];
  archivedCount: number;
  unmatched: string[];
} {
  const targets = new Set(entries.map((entry) => entry.trim()).filter(Boolean));
  const unmatched = new Set(targets);
  const archivedByDate = new Map<string, string[]>();
  const activeSections: MemorySection[] = [];
  let archivedCount = 0;

  for (const section of parsed.sections) {
    const keptBullets: string[] = [];

    for (const bullet of section.bullets) {
      const trimmed = bullet.trim();
      if (targets.has(trimmed)) {
        unmatched.delete(trimmed);
        archivedCount += 1;
        const archived = archivedByDate.get(section.date) ?? [];
        archived.push(bullet);
        archivedByDate.set(section.date, archived);
        continue;
      }

      keptBullets.push(bullet);
    }

    if (keptBullets.length > 0) {
      activeSections.push({ date: section.date, bullets: keptBullets });
    }
  }

  const archivedSections = [...archivedByDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, bullets]) => ({ date, bullets }));

  return {
    active: { preamble: parsed.preamble, sections: activeSections },
    archivedSections,
    archivedCount,
    unmatched: [...unmatched],
  };
}

export function formatArchiveAppend(
  archivedAt: Date,
  sections: MemorySection[],
  reason?: string,
): string {
  const lines = [`<!-- archived: ${archivedAt.toISOString()} -->`];

  if (reason?.trim()) {
    lines.push(`<!-- reason: ${reason.trim().replace(/-->/g, "")} -->`);
  }

  for (const section of sections) {
    lines.push("", `## ${section.date}`, "");
    for (const bullet of section.bullets) {
      lines.push(`- ${bullet}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export async function archiveProfileMemoryBullets(
  orgId: string,
  profileId: string,
  entries: string[],
  options: { reason?: string; archivedAt?: Date } = {},
): Promise<ArchiveMemoryResult> {
  const soulDir = getProfileSoulDir(orgId, profileId);
  const memoryPath = join(soulDir, "MEMORY.md");
  const existing = await readTextIfExists(memoryPath);

  if (!existing) {
    throw new Error("MEMORY.md does not exist.");
  }

  const parsed = parseMemoryContent(existing);
  const { active, archivedSections, archivedCount, unmatched } = partitionMemoryEntries(
    parsed,
    entries,
  );

  if (unmatched.length > 0) {
    throw new Error(`Memory entries not found: ${unmatched.join(", ")}`);
  }

  if (archivedCount === 0) {
    throw new Error("No matching memory entries found.");
  }

  const archivedAt = options.archivedAt ?? new Date();
  const archivePath = getMemoryArchiveFilePath(
    orgId,
    profileId,
    formatMemoryArchiveYearMonth(archivedAt),
  );
  const archiveAppend = formatArchiveAppend(archivedAt, archivedSections, options.reason);
  const archiveExists = await pathExists(archivePath);
  const archiveContent = archiveExists
    ? `${(await readText(archivePath)).replace(/\n+$/, "")}\n\n${archiveAppend}`
    : `${MEMORY_ARCHIVE_TEMPLATE}\n${archiveAppend}`;

  const activeContent = rebuildMemoryContent(active);
  const activeBytes = Buffer.byteLength(activeContent, "utf8");

  await writePrivateTextFile(archivePath, archiveContent);
  await writePrivateTextFile(memoryPath, activeContent, { ensureDir: soulDir });

  return {
    archived: archivedCount,
    activeBytes,
    archivePath,
  };
}
