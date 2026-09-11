import type { ProfileDetail, ToolSummary } from "@nakama/core/contract";
import { BUILTIN_TOOL_IDS } from "@nakama/core/tools/protected";
import { Button } from "@nakama/ui/button";
import { cn } from "@nakama/ui/utils";
import { Delete02Icon } from "hugeicons-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { EmailSettingsDialog } from "@/components/EmailSettingsDialog";
import { ToolAssignDialog } from "@/components/ToolAssignDialog";
import { useAuth } from "@/context/use-auth";
import { groupPluginTools, isPluginOwned } from "@/hooks/use-plugins";
import { canUseToolPlayground, toolPlaygroundPath } from "@/lib/navigation";
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
    activeOrg?.role
  );
  const [emailConfigOpen, setEmailConfigOpen] = useState(false);

  const groups = groupPluginTools(detail.tools);

  return (
    <div className="pt-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="type-section-title text-balance">Tools</h3>
          {detail.tools.length > 0 ? (
            <p className="type-body mt-1 text-xs tabular-nums">
              {groups.length} assigned
            </p>
          ) : null}
        </div>
        <ToolAssignDialog
          disabled={busy}
          groupPlugins
          onAssign={onAssign}
          tools={availableTools}
        />
      </div>

      {detail.tools.length === 0 ? (
        <p className="type-body text-pretty text-xs">No tools assigned.</p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
          {groups.map(({ tool, tools: members }) => {
            const name = (
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground text-sm leading-tight">
                  {tool.pluginId ?? tool.name}
                </p>
                {isPluginOwned(tool) ? (
                  <p className="truncate text-muted-foreground text-xs">
                    {members.length} actions
                  </p>
                ) : null}
              </div>
            );
            const onConfigure =
              isOrgAdmin && tool.id === BUILTIN_TOOL_IDS.email
                ? () => setEmailConfigOpen(true)
                : undefined;

            return (
              <li
                className="flex items-center justify-between gap-2 px-3 py-2 transition-colors duration-150 ease-out hover:bg-muted/40"
                key={tool.id}
              >
                {canOpenPlayground && !tool.pluginId ? (
                  <Link
                    aria-label={`Open playground for ${tool.name}`}
                    className={cn(
                      "min-w-0 flex-1 rounded-sm text-left outline-none transition-[text-decoration-color] duration-150 ease-out",
                      "underline decoration-transparent underline-offset-2 hover:decoration-foreground/40",
                      "focus-visible:ring-2 focus-visible:ring-ring/50",
                      busy && "pointer-events-none opacity-50"
                    )}
                    to={toolPlaygroundPath(tool.id, {
                      fromProfileId: detail.id,
                    })}
                  >
                    {name}
                  </Link>
                ) : (
                  <div className="min-w-0 flex-1">{name}</div>
                )}
                <div className="flex shrink-0 items-center gap-1">
                  {onConfigure ? (
                    <Button
                      disabled={busy}
                      onClick={onConfigure}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      Configure
                    </Button>
                  ) : null}
                  <Button
                    aria-label={`Delete ${tool.name}`}
                    className="relative text-muted-foreground transition-colors duration-150 ease-out after:absolute after:-inset-x-1.5 after:-inset-y-1 hover:text-destructive"
                    disabled={busy}
                    onClick={() =>
                      onRemove({
                        id: tool.id,
                        ids: members.map((entry) => entry.id),
                        kind: "tool",
                        name: tool.pluginId ?? tool.name,
                      })
                    }
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <Delete02Icon aria-hidden className="size-4" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <EmailSettingsDialog
        onOpenChange={setEmailConfigOpen}
        open={emailConfigOpen}
      />
    </div>
  );
}
