import { Trash2Icon } from "lucide-react";
import { SkillAssignPicker } from "@/components/SkillAssignPicker";
import { Button } from "@/components/ui/button";
import type { ProfileDetail, SkillSummary } from "@nakama/core/contract";
import type { RemoveAssignmentTarget } from "@/pages/profiles/profiles-page.shared";

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
}) {
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
        <ul className="divide-y divide-border rounded-md border border-border">
          {detail.skills.map((skill) => (
            <li
              key={skill.id}
              className="group flex items-center justify-between gap-2 px-3 py-2 first:rounded-t-md last:rounded-b-md hover:bg-muted/40"
            >
              <button
                type="button"
                disabled={busy}
                className="min-w-0 flex-1 text-left disabled:opacity-50"
                aria-label={`View details for ${skill.name}`}
                onClick={() => onViewDetail(skill.id)}
              >
                <p className="truncate text-sm font-medium leading-tight text-foreground">
                  {skill.name}
                </p>
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
          ))}
        </ul>
      )}
    </div>
  );
}
