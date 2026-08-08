import type {
  SkillCreatedBy,
  SkillDetail,
  SkillUsageSummary,
} from "@nakama/core/contract";
import { BUNDLED_SKILL_NAMES } from "@nakama/core/skills/bundled-names";
import { CodeBlock } from "@/components/ai-elements/code-block";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { formatSessionRelativeTime } from "@/lib/chat-history";
import { cn } from "@/lib/utils";

const bundledSkillNames = new Set<string>(BUNDLED_SKILL_NAMES);

function formatCreatedByLabel(value: SkillCreatedBy): string {
  if (value === "agent") {
    return "Agent";
  }

  if (value === "human") {
    return "Human";
  }

  return "Bundled";
}

function formatUsageTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "Never";
  }

  return formatSessionRelativeTime(value);
}

function formatSkillMeta(
  skill: Pick<SkillDetail, "hasTool" | "disableModelInvocation">
): string[] {
  const parts: string[] = [];

  if (skill.hasTool) {
    parts.push("includes tool");
  }

  if (skill.disableModelInvocation) {
    parts.push("explicit invoke only");
  }

  return parts;
}

function formatInlineMetaLine({
  skill,
  createdBy,
  usageSummary,
}: {
  skill: Pick<SkillDetail, "hasTool" | "disableModelInvocation">;
  createdBy?: SkillCreatedBy | null;
  usageSummary?: SkillUsageSummary | null;
}): string | null {
  const parts: string[] = [];

  if (createdBy) {
    parts.push(formatCreatedByLabel(createdBy));
  }

  for (const label of formatSkillMeta(skill)) {
    parts.push(label);
  }

  if (usageSummary) {
    if (usageSummary.useCount === 0 && !usageSummary.lastUsedAt) {
      parts.push("never matched");
    } else {
      const matchLabel = usageSummary.useCount === 1 ? "match" : "matches";
      parts.push(`${usageSummary.useCount} ${matchLabel}`);
      if (usageSummary.lastUsedAt) {
        parts.push(
          `last matched ${formatUsageTimestamp(usageSummary.lastUsedAt)}`
        );
      }
    }
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}

function canEditSkill(skill: SkillDetail): boolean {
  return !bundledSkillNames.has(skill.name);
}

const skillBodyScrollClass = "max-h-[min(calc(100dvh-13rem),48rem)]";

export function SkillDetailContent({
  skill,
  usageSummary,
  createdBy,
  editing = false,
  editBody = "",
  onEditBodyChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  saveBusy = false,
  saveError = null,
}: {
  skill: SkillDetail;
  usageSummary?: SkillUsageSummary | null;
  createdBy?: SkillCreatedBy | null;
  editing?: boolean;
  editBody?: string;
  onEditBodyChange?: (body: string) => void;
  onStartEdit?: () => void;
  onCancelEdit?: () => void;
  onSaveEdit?: () => void;
  saveBusy?: boolean;
  saveError?: string | null;
}) {
  const body = skill.body.trim();
  const editable = canEditSkill(skill);
  const inlineMeta = formatInlineMetaLine({ createdBy, skill, usageSummary });

  return (
    <div className="space-y-3 sm:space-y-4">
      <header className="space-y-1 sm:space-y-1.5">
        <h1 className="font-semibold text-base text-foreground">
          {skill.name}
        </h1>
        {skill.description ? (
          <p className="whitespace-pre-wrap text-muted-foreground text-sm leading-relaxed">
            {skill.description}
          </p>
        ) : null}
        {inlineMeta ? (
          <p className="text-muted-foreground text-xs">{inlineMeta}</p>
        ) : null}
      </header>

      {editing ? (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex shrink-0 items-center justify-between gap-2 border-border border-b px-3 py-2">
            <span className="font-medium text-muted-foreground text-xs">
              markdown
            </span>
            <div className="flex items-center gap-2">
              <Button
                disabled={saveBusy}
                onClick={onCancelEdit}
                size="sm"
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                disabled={saveBusy}
                onClick={onSaveEdit}
                size="sm"
                type="button"
              >
                {saveBusy ? <Spinner className="size-4" /> : "Save"}
              </Button>
            </div>
          </div>
          <Textarea
            className={cn(
              skillBodyScrollClass,
              "min-h-[min(50vh,28rem)] overflow-y-auto border-0 bg-muted/20 font-mono text-xs leading-6 shadow-none focus-visible:ring-0"
            )}
            disabled={saveBusy}
            onChange={(event) => onEditBodyChange?.(event.target.value)}
            value={editBody}
          />
        </div>
      ) : body ? (
        <CodeBlock
          className="rounded-lg border border-border"
          code={body}
          lang="markdown"
          maxScrollHeightClass={skillBodyScrollClass}
          onEdit={onStartEdit}
          showEdit={editable}
        />
      ) : editable ? (
        <div className="space-y-3 rounded-lg border border-border border-dashed px-4 py-6 text-center">
          <p className="text-muted-foreground text-sm">
            No skill body content.
          </p>
          <Button
            onClick={onStartEdit}
            size="sm"
            type="button"
            variant="outline"
          >
            Add instructions
          </Button>
        </div>
      ) : (
        <p className="rounded-lg border border-border border-dashed px-4 py-6 text-center text-muted-foreground text-sm">
          No skill body content.
        </p>
      )}

      {saveError ? (
        <p
          className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive text-sm"
          role="alert"
        >
          {saveError}
        </p>
      ) : null}
    </div>
  );
}
