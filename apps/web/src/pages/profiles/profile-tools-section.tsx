import { Trash2Icon } from "lucide-react";
import { ToolAssignDialog } from "@/components/ToolAssignDialog";
import { Button } from "@/components/ui/button";
import type { ProfileDetail, ToolSummary } from "@nakama/core/contract";
import type { RemoveAssignmentTarget } from "@/pages/profiles/profiles-page.shared";

export function ProfileToolsSection({
  detail,
  busy,
  availableTools,
  onAssign,
  onRemove,
}: {
  detail: ProfileDetail;
  busy: boolean;
  availableTools: ToolSummary[];
  onAssign: (toolId: string) => void;
  onRemove: (target: RemoveAssignmentTarget) => void;
}) {
  return (
    <div className="pt-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="type-section-title">Tools</h3>
          <p className="type-body mt-1 text-xs">
            {detail.tools.length === 0
              ? "No tools assigned to this profile."
              : `${detail.tools.length} assigned`}
          </p>
        </div>
        <ToolAssignDialog tools={availableTools} disabled={busy} onAssign={onAssign} />
      </div>

      {detail.tools.length === 0 ? (
        <p className="type-body text-xs">No tools assigned.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {detail.tools.map((tool) => (
            <li
              key={tool.id}
              className="flex items-center justify-between gap-2 px-3 py-2 first:rounded-t-md last:rounded-b-md"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium leading-tight text-foreground">
                  {tool.name}
                </p>
                <p className="mt-0.5 line-clamp-1 text-xs leading-snug text-muted-foreground">
                  {tool.description}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="shrink-0 text-muted-foreground/60 hover:text-destructive"
                disabled={busy}
                aria-label={`Delete ${tool.name}`}
                onClick={() => onRemove({ kind: "tool", id: tool.id, name: tool.name })}
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
