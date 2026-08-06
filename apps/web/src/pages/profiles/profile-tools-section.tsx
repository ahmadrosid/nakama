import { BASH_TOOL_ID, BUILTIN_TOOL_IDS } from "@nakama/core/tools/protected";
import { Trash2Icon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { CodingHarnessSettingsDialog } from "@/components/CodingHarnessSettingsDialog";
import { EmailSettingsDialog } from "@/components/EmailSettingsDialog";
import { ToolAssignDialog } from "@/components/ToolAssignDialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/use-auth";
import { canUseToolPlayground, toolPlaygroundPath } from "@/lib/navigation";
import { cn } from "@/lib/utils";
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
  const { user, activeOrg } = useAuth();
  const isOrgAdmin = activeOrg?.role === "admin";
  const canOpenPlayground = canUseToolPlayground(
    user?.isPlatformAdmin === true,
    activeOrg?.role,
  );
  const [emailConfigOpen, setEmailConfigOpen] = useState(false);
  const [codingHarnessConfigOpen, setCodingHarnessConfigOpen] = useState(false);

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
          {detail.tools.map((tool) => {
            const name = (
              <p className="truncate text-sm font-medium leading-tight text-foreground">
                {tool.name}
              </p>
            );
            const onConfigure =
              isOrgAdmin && tool.id === BUILTIN_TOOL_IDS.email
                ? () => setEmailConfigOpen(true)
                : isOrgAdmin && tool.id === BASH_TOOL_ID
                  ? () => setCodingHarnessConfigOpen(true)
                  : undefined;

            return (
              <li
                key={tool.id}
                className="group flex items-center justify-between gap-2 px-3 py-2 first:rounded-t-md last:rounded-b-md hover:bg-muted/40"
              >
                {canOpenPlayground ? (
                  <Link
                    to={toolPlaygroundPath(tool.id, { fromProfileId: detail.id })}
                    aria-label={`Open playground for ${tool.name}`}
                    className={cn(
                      "min-w-0 flex-1 text-left",
                      busy && "pointer-events-none opacity-50",
                    )}
                  >
                    {name}
                  </Link>
                ) : (
                  <div className="min-w-0 flex-1">{name}</div>
                )}
                <div className="flex shrink-0 items-center gap-1">
                  {onConfigure ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={onConfigure}
                    >
                      Configure
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground/60 hover:text-destructive"
                    disabled={busy}
                    aria-label={`Delete ${tool.name}`}
                    onClick={() => onRemove({ kind: "tool", id: tool.id, name: tool.name })}
                  >
                    <Trash2Icon className="size-4" aria-hidden />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <EmailSettingsDialog open={emailConfigOpen} onOpenChange={setEmailConfigOpen} />
      <CodingHarnessSettingsDialog
        open={codingHarnessConfigOpen}
        onOpenChange={setCodingHarnessConfigOpen}
      />
    </div>
  );
}
