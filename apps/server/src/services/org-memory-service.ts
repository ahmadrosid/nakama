import { join } from "node:path";
import {
  NakamaApiError,
  ORG_MEMORY_PREAMBLE,
  applyApprovedOrgMemoryBullet,
  appendOrgMemoryHistory,
  composeOrgMemorySummary,
  createOrgMemoryChangeId,
  detectOrgMemoryInjectionWarnings,
  getOrgMemoryArchiveDir,
  getOrgMemoryDir,
  getOrgMemoryFilePath,
  getOrgMemoryHistoryEntry,
  listOrgMemoryHistory,
  normalizeOrgMemoryDedupKey,
  parseOrgMemoryContent,
  rebuildOrgMemoryContent,
  type OrgMemoryChangeAction,
  type OrgMemoryChangeLogEntry,
} from "@nakama/core";
import {
  pathExists,
  readDirectoryEntries,
  readText,
  readTextIfExists,
  writePrivateTextFile,
} from "@nakama/core/fs";
import type { DatabaseAdapter, StoredOrgMemoryProposal } from "@nakama/db";

const SUMMARY_BYTE_CAP = 2048;
const MAX_PROPOSAL_BULLET_LENGTH = 500;

export interface OrgMemoryContent {
  content: string;
}

export type OrgMemorySearchTier = "pinned" | "recent-log" | "archive";

export interface OrgMemorySearchMatch {
  source: "live" | string;
  bullet: string;
  tier: OrgMemorySearchTier;
  date?: string;
}

export interface OrgMemorySearchResult {
  query: string;
  matches: OrgMemorySearchMatch[];
}

export type ProposeOrgMemoryOutcome =
  | "created"
  | "already_pending"
  | "already_pinned"
  | "already_in_recent_log";

export interface ProposeOrgMemoryResult {
  outcome: ProposeOrgMemoryOutcome;
  proposalId?: string;
  message: string;
  warnings?: string[];
}

export interface ProposeOrgMemoryInput {
  bullet: string;
  profileId?: string | null;
  sessionId?: string | null;
  proposedByUserId?: string | null;
}

export interface OrgMemoryApprovedBulletMerger {
  merge(
    content: string,
    bullet: string,
    options: { pin: boolean; dateUtc: string },
  ): Promise<string | null>;
}

export interface OrgMemoryServiceOptions {
  approvedBulletMerger?: OrgMemoryApprovedBulletMerger;
  configDir?: string;
}

export interface OrgMemoryChangeContext {
  actorUserId?: string | null;
  action: OrgMemoryChangeAction;
  label: string;
  restoredFromId?: string | null;
}

export class OrgMemoryService {
  constructor(
    private readonly database: DatabaseAdapter | null = null,
    private readonly options: OrgMemoryServiceOptions = {},
  ) {}

  /**
   * Read the live org MEMORY.md. Returns the canonical preamble when the file
   * does not yet exist (so callers always get a usable string).
   */
  async getMemory(orgId: string): Promise<string> {
    const existing = await readTextIfExists(getOrgMemoryFilePath(orgId, this.options.configDir));
    if (!existing || existing.trim().length === 0) {
      return `${ORG_MEMORY_PREAMBLE}\n`;
    }
    return existing;
  }

  /** Render the `## Org Memory` section injected into profile system prompts. */
  async getSummary(orgId: string): Promise<string> {
    const content = await this.getMemory(orgId);
    return composeOrgMemorySummary(content, { byteCap: SUMMARY_BYTE_CAP });
  }

  /** Replace the entire live MEMORY.md content (admin only). */
  async setMemory(
    orgId: string,
    content: string,
    change?: OrgMemoryChangeContext,
  ): Promise<void> {
    const trimmed = content.trim();
    if (Buffer.byteLength(trimmed, "utf8") > SUMMARY_BYTE_CAP * 4) {
      throw new NakamaApiError("Org memory content exceeds the size limit.", 400);
    }
    const normalized = trimmed.length > 0 ? `${trimmed.replace(/\n+$/, "")}\n` : `${ORG_MEMORY_PREAMBLE}\n`;
    await this.commitMemory(orgId, normalized, change ?? {
      action: "edit",
      label: "Manual edit",
    });
  }

  async listHistory(orgId: string, limit?: number): Promise<OrgMemoryChangeLogEntry[]> {
    return listOrgMemoryHistory(orgId, limit, this.options.configDir);
  }

  async getHistoryRevision(orgId: string, revisionId: string) {
    const record = await getOrgMemoryHistoryEntry(orgId, revisionId, this.options.configDir);
    if (!record) {
      throw new NakamaApiError("Org memory history revision not found.", 404);
    }

    const { content, ...change } = record;
    return { change, content };
  }

  async restoreHistoryRevision(
    orgId: string,
    revisionId: string,
    actorUserId: string,
  ): Promise<string> {
    const record = await getOrgMemoryHistoryEntry(orgId, revisionId, this.options.configDir);
    if (!record) {
      throw new NakamaApiError("Org memory history revision not found.", 404);
    }

    await this.commitMemory(orgId, record.content, {
      actorUserId,
      action: "restore",
      label: `Restored snapshot from ${new Date(record.createdAt).toLocaleString()}`,
      restoredFromId: revisionId,
    });
    return record.content;
  }

  async undoLastChange(orgId: string, actorUserId: string): Promise<string> {
    const history = await listOrgMemoryHistory(orgId, 2, this.options.configDir);
    if (history.length < 2) {
      throw new NakamaApiError("No previous org memory revision to restore.", 404);
    }

    return this.restoreHistoryRevision(orgId, history[1]!.id, actorUserId);
  }

  /**
   * Admin direct-create: add a fact to the pinned section. Creates MEMORY.md
   * with the canonical preamble if it is missing. Idempotent — adding a
   * bullet that is already pinned is a no-op.
   */
  async addFact(
    orgId: string,
    bullet: string,
    options: { pin?: boolean; change?: OrgMemoryChangeContext } = {},
  ): Promise<void> {
    const text = this.normalizeBullet(bullet);
    const content = await this.getMemory(orgId);
    const parsed = parseOrgMemoryContent(content);

    if (parsed.pinned.some((existing) => existing.trim() === text)) {
      return;
    }

    const next = applyApprovedOrgMemoryBullet(content, text, { pin: true });
    await this.commitMemory(orgId, next, options.change ?? {
      action: "add_fact",
      label: `Added fact: ${truncateLabel(text)}`,
    });
  }

  async addRecentLogFact(
    orgId: string,
    bullet: string,
    dateUtc: string,
    change?: OrgMemoryChangeContext,
  ): Promise<void> {
    const text = this.normalizeBullet(bullet);
    const content = await this.getMemory(orgId);
    const parsedBefore = parseOrgMemoryContent(content);
    if (this.bulletExistsInMemory(parsedBefore, text)) {
      return;
    }
    const next = applyApprovedOrgMemoryBullet(content, text, { pin: false, dateUtc });
    await this.commitMemory(orgId, next, change ?? {
      action: "add_fact",
      label: `Added recent log fact: ${truncateLabel(text)}`,
    });
  }

  /** Pin an existing bullet (move to pinned if dated, or add). */
  async pinFact(orgId: string, bullet: string, change?: OrgMemoryChangeContext): Promise<void> {
    const text = this.normalizeBullet(bullet);
    const content = await this.getMemory(orgId);
    const parsed = parseOrgMemoryContent(content);

    if (parsed.pinned.some((existing) => existing.trim() === text)) {
      return;
    }

    for (const section of parsed.sections) {
      const index = section.bullets.findIndex((existing) => existing.trim() === text);
      if (index !== -1) {
        section.bullets.splice(index, 1);
      }
    }

    parsed.pinned.push(text);
    await this.commitMemory(orgId, rebuildOrgMemoryContent(parsed), change ?? {
      action: "pin",
      label: `Pinned fact: ${truncateLabel(text)}`,
    });
  }

  /** Remove a bullet from the pinned section. 404 if it is not pinned. */
  async unpinFact(orgId: string, bullet: string, change?: OrgMemoryChangeContext): Promise<void> {
    const text = this.normalizeBullet(bullet);
    const content = await this.getMemory(orgId);
    const parsed = parseOrgMemoryContent(content);

    const index = parsed.pinned.findIndex((existing) => existing.trim() === text);
    if (index === -1) {
      throw new NakamaApiError("Pinned fact not found.", 404);
    }
    parsed.pinned.splice(index, 1);
    await this.commitMemory(orgId, rebuildOrgMemoryContent(parsed), change ?? {
      action: "unpin",
      label: `Unpinned fact: ${truncateLabel(text)}`,
    });
  }

  async archiveEntries(
    orgId: string,
    entries: string[],
    options: { reason?: string; archivedAt?: Date; change?: OrgMemoryChangeContext } = {},
  ) {
    const targets = new Set(
      entries.map((e) => e.trim().replace(/^-\s+/, "").trim()).filter(Boolean),
    );
    if (targets.size === 0) {
      throw new NakamaApiError("No memory entries provided.", 400);
    }

    const content = await this.getMemory(orgId);
    const parsed = parseOrgMemoryContent(content);
    const kept: string[] = [];
    const archived: string[] = [];
    const unmatched: string[] = [];

    for (const bullet of parsed.pinned) {
      if (targets.has(bullet.trim())) {
        archived.push(bullet);
      } else {
        kept.push(bullet);
      }
    }
    for (const target of targets) {
      if (!archived.some((b) => b.trim() === target)) {
        unmatched.push(target);
      }
    }
    if (unmatched.length > 0) {
      throw new NakamaApiError(`Memory entries not found: ${unmatched.join(", ")}`, 404);
    }
    if (archived.length === 0) {
      throw new NakamaApiError("No matching memory entries found.", 404);
    }

    const archivedAt = options.archivedAt ?? new Date();
    const yearMonth = `${archivedAt.getFullYear()}-${String(archivedAt.getMonth() + 1).padStart(2, "0")}`;
    const archiveDir = getOrgMemoryArchiveDir(orgId, this.options.configDir);
    const archivePath = join(archiveDir, `${yearMonth}.md`);
    const appendLines = [`<!-- archived: ${archivedAt.toISOString()} -->`];
    if (options.reason?.trim()) {
      appendLines.push(`<!-- reason: ${options.reason.trim().replace(/-->/g, "")} -->`);
    }
    appendLines.push("", "## Pinned", "");
    for (const bullet of archived) {
      appendLines.push(`- ${bullet}`);
    }
    const append = `${appendLines.join("\n")}\n`;

    const archiveExists = await pathExists(archivePath);
    const archiveContent = archiveExists
      ? `${(await readText(archivePath)).replace(/\n+$/, "")}\n\n${append}`
      : `# Archived Org Memory\n\n---\n\n${append}`;

    const activeContent = rebuildOrgMemoryContent({
      preamble: parsed.preamble,
      pinned: kept,
      sections: parsed.sections,
    });
    await writePrivateTextFile(archivePath, archiveContent, { ensureDir: archiveDir });
    await this.commitMemory(orgId, activeContent, options.change ?? {
      action: "archive",
      label: `Archived ${archived.length} pinned ${archived.length === 1 ? "fact" : "facts"}`,
    });

    return {
      archived: archived.length,
      activeBytes: Buffer.byteLength(activeContent, "utf8"),
      archivePath,
    };
  }

  async listProposals(
    orgId: string,
    status?: StoredOrgMemoryProposal["status"],
  ): Promise<StoredOrgMemoryProposal[]> {
    return this.requireDatabase().listOrgMemoryProposals(orgId, status);
  }

  async countPendingProposals(orgId: string): Promise<number> {
    return this.requireDatabase().countOrgMemoryProposals(orgId, "pending");
  }

  async getProposal(orgId: string, proposalId: string): Promise<StoredOrgMemoryProposal> {
    const proposal = await this.requireDatabase().getOrgMemoryProposal(orgId, proposalId);
    if (!proposal) {
      throw new NakamaApiError("Org memory proposal not found.", 404);
    }
    return proposal;
  }

  async propose(orgId: string, input: ProposeOrgMemoryInput): Promise<ProposeOrgMemoryResult> {
    const text = this.normalizeProposalBullet(input.bullet);
    const warnings = detectOrgMemoryInjectionWarnings(text);
    const content = await this.getMemory(orgId);
    const parsed = parseOrgMemoryContent(content);
    const dedupKey = normalizeOrgMemoryDedupKey(text);
    const db = this.requireDatabase();

    if (parsed.pinned.some((bullet) => normalizeOrgMemoryDedupKey(bullet) === dedupKey)) {
      return {
        outcome: "already_pinned",
        message: "This is already in org memory (pinned).",
      };
    }

    if (
      parsed.sections.some((section) =>
        section.bullets.some((bullet) => normalizeOrgMemoryDedupKey(bullet) === dedupKey),
      )
    ) {
      return {
        outcome: "already_in_recent_log",
        message: "This is already in org memory (recent log).",
      };
    }

    const pending = await db.getPendingOrgMemoryProposalByBullet(orgId, text);
    if (pending) {
      return {
        outcome: "already_pending",
        proposalId: pending.id,
        message: "This fact is already awaiting admin approval.",
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    }

    const now = new Date().toISOString();
    const proposal: StoredOrgMemoryProposal = {
      id: `prop_${crypto.randomUUID().replace(/-/g, "")}`,
      orgId,
      profileId: input.profileId ?? null,
      sessionId: input.sessionId ?? null,
      proposedByUserId: input.proposedByUserId ?? null,
      bullet: text,
      status: "pending",
      pinned: false,
      reviewerUserId: null,
      reviewedAt: null,
      createdAt: now,
    };
    await db.createOrgMemoryProposal(proposal);

    return {
      outcome: "created",
      proposalId: proposal.id,
      message: `Recorded for admin review (proposal ${proposal.id}).`,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  async approveProposal(
    orgId: string,
    proposalId: string,
    reviewerUserId: string,
    options: { pin?: boolean } = {},
  ): Promise<StoredOrgMemoryProposal> {
    const db = this.requireDatabase();
    const proposal = await this.getProposal(orgId, proposalId);

    if (proposal.status === "approved") {
      return proposal;
    }

    if (proposal.status !== "pending") {
      throw new NakamaApiError("Only pending proposals can be approved.", 400);
    }

    const pin = options.pin ?? false;
    const dateUtc = utcDateString();
    const content = await this.getMemory(orgId);

    let next = applyApprovedOrgMemoryBullet(content, proposal.bullet, { pin, dateUtc });
    if (this.options.approvedBulletMerger) {
      const merged = await this.options.approvedBulletMerger.merge(content, proposal.bullet, {
        pin,
        dateUtc,
      });
      if (merged) {
        next = merged;
      }
    }

    await this.commitMemory(orgId, next, {
      actorUserId: reviewerUserId,
      action: "approve",
      label: `Approved proposal: ${truncateLabel(proposal.bullet)}`,
    });

    const reviewedAt = new Date().toISOString();
    await db.updateOrgMemoryProposalStatus(orgId, proposalId, {
      status: "approved",
      reviewerUserId,
      reviewedAt,
      pinned: pin,
    });

    return {
      ...proposal,
      status: "approved",
      reviewerUserId,
      reviewedAt,
      pinned: pin,
    };
  }

  async rejectProposal(
    orgId: string,
    proposalId: string,
    reviewerUserId: string,
  ): Promise<StoredOrgMemoryProposal> {
    const db = this.requireDatabase();
    const proposal = await this.getProposal(orgId, proposalId);

    if (proposal.status === "rejected") {
      return proposal;
    }

    if (proposal.status !== "pending") {
      throw new NakamaApiError("Only pending proposals can be rejected.", 400);
    }

    const reviewedAt = new Date().toISOString();
    await db.updateOrgMemoryProposalStatus(orgId, proposalId, {
      status: "rejected",
      reviewerUserId,
      reviewedAt,
      pinned: false,
    });

    return {
      ...proposal,
      status: "rejected",
      reviewerUserId,
      reviewedAt,
    };
  }

  /** Full-text scan of live MEMORY.md + all archive files. */
  async search(orgId: string, query: string): Promise<OrgMemorySearchResult> {
    const normalizedQuery = query.trim().toLowerCase();
    const matches: OrgMemorySearchMatch[] = [];

    if (normalizedQuery === "") {
      return { query, matches };
    }

    const live = await readTextIfExists(getOrgMemoryFilePath(orgId, this.options.configDir));
    if (live) {
      const parsed = parseOrgMemoryContent(live);
      for (const bullet of parsed.pinned) {
        if (bullet.toLowerCase().includes(normalizedQuery)) {
          matches.push({ source: "live", bullet, tier: "pinned" });
        }
      }
      for (const section of parsed.sections) {
        for (const bullet of section.bullets) {
          if (bullet.toLowerCase().includes(normalizedQuery)) {
            matches.push({
              source: "live",
              bullet,
              tier: "recent-log",
              date: section.date,
            });
          }
        }
      }
    }

    const archiveDir = getOrgMemoryArchiveDir(orgId, this.options.configDir);
    if (await pathExists(archiveDir)) {
      const entries = await readDirectoryEntries(archiveDir);
      const files = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
        .map((entry) => entry.name)
        .sort();
      for (const filename of files) {
        const archiveContent = await readText(join(archiveDir, filename));
        for (const bullet of this.collectArchiveBullets(archiveContent)) {
          if (bullet.toLowerCase().includes(normalizedQuery)) {
            matches.push({ source: filename, bullet, tier: "archive" });
          }
        }
      }
    }

    return { query, matches };
  }

  private bulletExistsInMemory(
    parsed: ReturnType<typeof parseOrgMemoryContent>,
    text: string,
  ): boolean {
    const dedupKey = normalizeOrgMemoryDedupKey(text);
    if (parsed.pinned.some((bullet) => normalizeOrgMemoryDedupKey(bullet) === dedupKey)) {
      return true;
    }
    return parsed.sections.some((section) =>
      section.bullets.some((bullet) => normalizeOrgMemoryDedupKey(bullet) === dedupKey),
    );
  }

  private collectArchiveBullets(content: string): string[] {
    const bullets: string[] = [];
    for (const line of content.split("\n")) {
      if (line.startsWith("- ")) {
        bullets.push(line.slice(2));
      }
    }
    return bullets;
  }

  private normalizeBullet(bullet: string): string {
    const text = bullet.trim().replace(/^-\s+/, "").trim();
    if (text.length === 0) {
      throw new NakamaApiError("Memory bullet must not be empty.", 400);
    }
    return text;
  }

  private normalizeProposalBullet(bullet: string): string {
    const text = this.normalizeBullet(bullet);
    if (text.length > MAX_PROPOSAL_BULLET_LENGTH) {
      throw new NakamaApiError(
        `Memory bullet exceeds the ${MAX_PROPOSAL_BULLET_LENGTH} character limit.`,
        400,
      );
    }
    if (text.includes("\n\n")) {
      throw new NakamaApiError("Memory bullet must not contain multiple blank lines.", 400);
    }
    if (/^##\s/m.test(text)) {
      throw new NakamaApiError("Memory bullet must not contain markdown headings.", 400);
    }
    return text;
  }

  private requireDatabase(): DatabaseAdapter {
    if (!this.database) {
      throw new NakamaApiError("Org memory proposals are not configured.", 500);
    }
    return this.database;
  }

  private async commitMemory(
    orgId: string,
    content: string,
    change: OrgMemoryChangeContext,
  ): Promise<void> {
    const current = await this.getMemory(orgId);
    if (current === content) {
      return;
    }

    await writePrivateTextFile(getOrgMemoryFilePath(orgId, this.options.configDir), content, {
      ensureDir: getOrgMemoryDir(orgId, this.options.configDir),
    });

    const entry: OrgMemoryChangeLogEntry = {
      id: createOrgMemoryChangeId(),
      orgId,
      createdAt: new Date().toISOString(),
      actorUserId: change.actorUserId ?? null,
      action: change.action,
      label: change.label,
      restoredFromId: change.restoredFromId ?? null,
    };
    await appendOrgMemoryHistory(orgId, entry, content, this.options.configDir);
  }
}

function utcDateString(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function truncateLabel(value: string, maxLength = 80): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`;
}
