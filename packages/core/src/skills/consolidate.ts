import { BUNDLED_SKILL_NAMES } from "./bundled-names";
import { isGlobalSkillSourcePath } from "./dedupe";

/** Skip skills patched within this window (null lastPatchedAt = eligible). */
export const SKILL_CONSOLIDATE_RECENT_PATCH_MS = 14 * 24 * 60 * 60 * 1000;

export const SKILL_CONSOLIDATE_MAX_CLUSTERS_PER_RUN = 3;
export const SKILL_CONSOLIDATE_MAX_SOLOS_PER_RUN = 3;
/** Minimum Jaccard overlap on name+description tokens to form a cluster. */
export const SKILL_CONSOLIDATE_MIN_OVERLAP = 0.45;
/** Description+body length above which a non-clustered agent skill is a solo deslopify candidate. */
export const SKILL_CONSOLIDATE_VERBOSE_CHAR_THRESHOLD = 2500;

const bundledSkillNames = new Set<string>(BUNDLED_SKILL_NAMES);

export type SkillConsolidateSkipReason =
  | "not_agent"
  | "bundled"
  | "global"
  | "recent_patch"
  | "pending_proposal"
  | "automation_profile";

export interface ConsolidateCandidateSkill {
  body: string;
  createdBy: string;
  description: string;
  id: string;
  lastPatchedAt?: string | null;
  lastUsedAt?: string | null;
  name: string;
  sourcePath: string;
  useCount?: number;
}

export interface ConsolidateCluster {
  losers: ConsolidateCandidateSkill[];
  winner: ConsolidateCandidateSkill;
}

export interface ConsolidatePlan {
  budgetExhausted: boolean;
  clusters: ConsolidateCluster[];
  skippedCount: number;
  solos: ConsolidateCandidateSkill[];
}

export interface BuildConsolidatePlanInput {
  /** When true, every skill is skipped as automation_profile. */
  hasEnabledAutomation?: boolean;
  now?: Date;
  pendingSkillNames?: ReadonlySet<string>;
  skills: ConsolidateCandidateSkill[];
}

function toTimestamp(value: string): number | null {
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

function tokenize(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2);
  return new Set(tokens);
}

export function skillTokenSet(skill: ConsolidateCandidateSkill): Set<string> {
  return tokenize(`${skill.name} ${skill.description}`);
}

export function jaccardOverlap(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 && right.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) {
      intersection += 1;
    }
  }
  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function isExemptFromConsolidate(
  skill: ConsolidateCandidateSkill
): boolean {
  if (skill.createdBy === "bundled") {
    return true;
  }
  if (bundledSkillNames.has(skill.name)) {
    return true;
  }
  return isGlobalSkillSourcePath(skill.sourcePath);
}

export function classifyConsolidateEligibility(input: {
  hasEnabledAutomation?: boolean;
  now?: Date;
  pendingSkillNames?: ReadonlySet<string>;
  skill: ConsolidateCandidateSkill;
}): SkillConsolidateSkipReason | null {
  if (input.hasEnabledAutomation) {
    return "automation_profile";
  }
  if (input.skill.createdBy !== "agent") {
    return "not_agent";
  }
  if (isExemptFromConsolidate(input.skill)) {
    return bundledSkillNames.has(input.skill.name) ? "bundled" : "global";
  }
  if (input.pendingSkillNames?.has(input.skill.name)) {
    return "pending_proposal";
  }
  const patchedAt = input.skill.lastPatchedAt;
  if (patchedAt) {
    const patchedMs = toTimestamp(patchedAt);
    if (patchedMs != null) {
      const now = input.now?.getTime() ?? Date.now();
      if (now - patchedMs < SKILL_CONSOLIDATE_RECENT_PATCH_MS) {
        return "recent_patch";
      }
    }
  }
  return null;
}

function rankScore(candidate: ConsolidateCandidateSkill): number {
  const useCount = candidate.useCount ?? 0;
  const lastUsed = candidate.lastUsedAt
    ? (toTimestamp(candidate.lastUsedAt) ?? 0)
    : 0;
  return useCount * 1_000_000_000_000 + lastUsed;
}

function compareCandidates(
  left: ConsolidateCandidateSkill,
  right: ConsolidateCandidateSkill
): number {
  const scoreDiff = rankScore(right) - rankScore(left);
  if (scoreDiff !== 0) {
    return scoreDiff;
  }
  return left.name.localeCompare(right.name);
}

function contentLength(candidate: ConsolidateCandidateSkill): number {
  return candidate.description.length + candidate.body.length;
}

/**
 * Pure planning helper: filter eligible agent skills, form overlapping clusters,
 * and list solo deslopify candidates under per-run budget caps.
 */
export function buildConsolidatePlan(
  input: BuildConsolidatePlanInput
): ConsolidatePlan {
  const skillNames = new Set(input.skills.map((skill) => skill.name));
  if (skillNames.size !== input.skills.length) {
    throw new Error("Consolidation candidates must have unique names.");
  }

  let skippedCount = 0;
  const eligible: ConsolidateCandidateSkill[] = [];

  for (const candidate of input.skills) {
    const reason = classifyConsolidateEligibility({
      hasEnabledAutomation: input.hasEnabledAutomation,
      now: input.now,
      pendingSkillNames: input.pendingSkillNames,
      skill: candidate,
    });
    if (reason) {
      skippedCount += 1;
      continue;
    }
    eligible.push(candidate);
  }

  const tokenByName = new Map<string, Set<string>>();
  for (const candidate of eligible) {
    tokenByName.set(candidate.name, skillTokenSet(candidate));
  }

  const assigned = new Set<string>();
  const clusters: ConsolidateCluster[] = [];

  const sorted = [...eligible].sort(compareCandidates);

  for (const seed of sorted) {
    if (assigned.has(seed.name)) {
      continue;
    }
    if (clusters.length >= SKILL_CONSOLIDATE_MAX_CLUSTERS_PER_RUN) {
      break;
    }

    const seedTokens = tokenByName.get(seed.name);
    if (!seedTokens) {
      continue;
    }

    const members: ConsolidateCandidateSkill[] = [seed];
    for (const other of sorted) {
      if (other.name === seed.name) {
        continue;
      }
      if (assigned.has(other.name)) {
        continue;
      }
      const otherTokens = tokenByName.get(other.name);
      if (!otherTokens) {
        continue;
      }
      if (
        jaccardOverlap(seedTokens, otherTokens) >= SKILL_CONSOLIDATE_MIN_OVERLAP
      ) {
        members.push(other);
      }
    }

    if (members.length < 2) {
      continue;
    }

    members.sort(compareCandidates);
    const winner = members[0];
    if (!winner) {
      continue;
    }
    const losers = members.slice(1);
    for (const member of members) {
      assigned.add(member.name);
    }
    clusters.push({ losers, winner });
  }

  const remaining = sorted.filter((candidate) => !assigned.has(candidate.name));

  const solos: ConsolidateCandidateSkill[] = [];
  let budgetExhausted = false;
  for (const candidate of remaining) {
    if (contentLength(candidate) < SKILL_CONSOLIDATE_VERBOSE_CHAR_THRESHOLD) {
      continue;
    }
    if (solos.length >= SKILL_CONSOLIDATE_MAX_SOLOS_PER_RUN) {
      skippedCount += 1;
      budgetExhausted = true;
      continue;
    }
    solos.push(candidate);
  }

  return { budgetExhausted, clusters, skippedCount, solos };
}
