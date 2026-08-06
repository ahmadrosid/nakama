import { Trash2Icon } from "lucide-react";
import { useMemo } from "react";
import { BASH_TOOL_ID } from "@nakama/core/tools/protected";
import type { ProfileDetail, SkillSummary, SkillUsageSummary } from "@nakama/core/contract";
import { BUNDLED_SKILL_NAMES } from "@nakama/core/skills/bundled-names";
import { SkillAssignPicker } from "@/components/SkillAssignPicker";
import { Button } from "@/components/ui/button";
import { formatSessionRelativeTime } from "@/lib/chat-history";
import type { RemoveAssignmentTarget } from "@/pages/profiles/profiles-page.shared";

const UNUSED_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const bundledSkillNames = new Set<string>(BUNDLED_SKILL_NAMES);

const EMPTY_SKILL_USAGE: SkillUsageSummary = {
  viewCount: 0,
  useCount: 0,
  patchCount: 0,
  lastViewedAt: null,
  lastUsedAt: null,
  lastPatchedAt: null,
};

function isBundledSkill(skill: SkillSummary): boolean {
  return skill.createdBy === "bundled" || bundledSkillNames.has(skill.name);
}

function skillUsage(skill: SkillSummary): SkillUsageSummary {
  return skill.usage ?? EMPTY_SKILL_USAGE;
}

function formatSkillUsageHint(skill: SkillSummary): string | null {
  const usage = skillUsage(skill);

  if (isBundledSkill(skill) && usage.useCount === 0 && !usage.lastUsedAt) {
    return null;
  }

  if (usage.useCount === 0 && !usage.lastUsedAt) {
    return "Never matched";
  }

  const lastLabel = usage.lastUsedAt
    ? formatSessionRelativeTime(usage.lastUsedAt)
    : "never";
  const useLabel = usage.useCount === 1 ? "use" : "uses";
  return `Last matched ${lastLabel} · ${usage.useCount} ${useLabel}`;
}

function isSkillUnused(skill: SkillSummary): boolean {
  if (isBundledSkill(skill)) {
    return false;
  }

  const usage = skillUsage(skill);

  if (!usage.lastUsedAt) {
    return usage.useCount === 0;
  }

  return Date.now() - new Date(usage.lastUsedAt).getTime() >= UNUSED_AFTER_MS;
}

function compareAssignedSkills(a: SkillSummary, b: SkillSummary): number {
  const aBundled = isBundledSkill(a);
  const bBundled = isBundledSkill(b);
  if (aBundled !== bBundled) {
    return aBundled ? 1 : -1;
  }

  return a.name.localeCompare(b.name);
}

function SkillStatusBadge({ skill }: { skill: SkillSummary }) {
  if (isBundledSkill(skill) || !isSkillUnused(skill)) {
    return null;
  }

  return (
    <span className="shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      Unused
    </span>
  );
}

function ProfileSkillRow({
  skill,
  busy,
  onViewDetail,
  onRemove,
}: {
  skill: SkillSummary;
  busy: boolean;
  onViewDetail: (skillId: string) => void;
  onRemove: (target: RemoveAssignmentTarget) => void;
}) {
  const usageHint = formatSkillUsageHint(skill);

  return (
    <li className="group flex items-center justify-between gap-2 px-3 py-2 hover:bg-muted/40">
      <button
        type="button"
        disabled={busy}
        className="min-w-0 flex-1 text-left disabled:opacity-50"
        aria-label={`View details for ${skill.name}`}
        onClick={() => onViewDetail(skill.id)}
      >
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-sm font-medium leading-tight text-foreground">{skill.name}</p>
          <SkillStatusBadge skill={skill} />
        </div>
        {usageHint ? (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{usageHint}</p>
        ) : null}
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="shrink-0 text-muted-foreground/60 hover:text-destructive"
        disabled={busy}
        aria-label={`Delete ${skill.name}`}
        onClick={() => onRemove({ kind: "skill", id: skill.id, name: skill.name })}
      >
        <Trash2Icon className="size-4" aria-hidden />
      </Button>
    </li>
  );
}

function SkillGroupHeader({ label }: { label: string }) {
  return (
    <li className="border-b border-border bg-muted/20 px-3 py-1.5 text-xs font-medium text-muted-foreground">
      {label}
    </li>
  );
}

export function ProfileSkillsSection({
  detail,
  busy,
  allSkills,
  assignedSkillIds,
  onCreateOpen,
  onAssign,
  onDelete,
  onViewDetail,
  onRemove,
  onAssignBash,
}: {
  detail: ProfileDetail;
  busy: boolean;
  allSkills: SkillSummary[];
  assignedSkillIds: ReadonlySet<string>;
  onCreateOpen: () => void;
  onAssign: (skillId: string) => void;
  onDelete: (skillId: string) => void;
  onViewDetail: (skillId: string) => void;
  onRemove: (target: RemoveAssignmentTarget) => void;
  onAssignBash: () => void | Promise<void>;
}) {
  const sortedSkills = useMemo(
    () => detail.skills.toSorted(compareAssignedSkills),
    [detail.skills],
  );
  const customSkills = useMemo(
    () => sortedSkills.filter((skill) => !isBundledSkill(skill)),
    [sortedSkills],
  );
  const bundledSkills = useMemo(
    () => sortedSkills.filter((skill) => isBundledSkill(skill)),
    [sortedSkills],
  );
  const showGroupHeaders = customSkills.length > 0 && bundledSkills.length > 0;

  return (
    <div className="pt-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="type-section-title">Skills</h3>
          {detail.skills.length > 0 ? (
            <p className="type-body mt-1 text-xs">{detail.skills.length} assigned</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onCreateOpen}>
            Create skill
          </Button>
          <SkillAssignPicker
            skills={allSkills}
            assignedSkillIds={assignedSkillIds}
            disabled={busy}
            buttonLabel="Add skills"
            onAssign={onAssign}
            onDelete={onDelete}
            bashAssigned={detail.tools.some((tool) => tool.id === BASH_TOOL_ID)}
            onAssignBash={onAssignBash}
          />
        </div>
      </div>

      {allSkills.length === 0 ? (
        <p className="type-body text-xs text-muted-foreground">
          Create one above, or add{" "}
          <code className="rounded bg-muted px-1 py-0.5">SKILL.md</code> folders to{" "}
          <code className="rounded bg-muted px-1 py-0.5">agent/skills</code>.
        </p>
      ) : detail.skills.length === 0 ? null : (
        <div className="overflow-hidden rounded-md border border-border">
          {customSkills.length > 0 ? (
            <ul className="divide-y divide-border">
              {showGroupHeaders ? <SkillGroupHeader label="Your skills" /> : null}
              {customSkills.map((skill) => (
                <ProfileSkillRow
                  key={skill.id}
                  skill={skill}
                  busy={busy}
                  onViewDetail={onViewDetail}
                  onRemove={onRemove}
                />
              ))}
            </ul>
          ) : null}
          {bundledSkills.length > 0 ? (
            <ul
              className={
                customSkills.length > 0 ? "divide-y divide-border border-t border-border" : "divide-y divide-border"
              }
            >
              {showGroupHeaders || customSkills.length === 0 ? (
                <SkillGroupHeader label="Built-in skills" />
              ) : null}
              {bundledSkills.map((skill) => (
                <ProfileSkillRow
                  key={skill.id}
                  skill={skill}
                  busy={busy}
                  onViewDetail={onViewDetail}
                  onRemove={onRemove}
                />
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </div>
  );
}
