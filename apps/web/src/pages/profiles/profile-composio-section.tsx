import { Trash2Icon } from "lucide-react";
import { ComposioToolkitAssignPicker } from "@/components/ComposioToolkitAssignPicker";
import { Button } from "@/components/ui/button";
import type { RemoveAssignmentTarget } from "@/pages/profiles/profiles-page.shared";
import type { ProfilesPageState } from "@/pages/profiles/use-profiles-page";

export function ProfileComposioSection({
  busy,
  composioToolkitsData,
  assignedComposioToolkits,
  availableComposioToolkits,
  onAssign,
  onRemove,
}: {
  busy: boolean;
  composioToolkitsData: ProfilesPageState["composioToolkitsData"];
  assignedComposioToolkits: ProfilesPageState["assignedComposioToolkits"];
  availableComposioToolkits: ProfilesPageState["availableComposioToolkits"];
  onAssign: (toolkitId: string) => void;
  onRemove: (target: RemoveAssignmentTarget) => void;
}) {
  if (!composioToolkitsData?.configured) {
    return null;
  }

  return (
    <div className="pt-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="type-section-title">Composio toolkits</h3>
          {assignedComposioToolkits.length > 0 ? (
            <p className="type-body mt-1 text-xs">{assignedComposioToolkits.length} assigned</p>
          ) : null}
        </div>
        <ComposioToolkitAssignPicker
          toolkits={availableComposioToolkits}
          disabled={busy}
          buttonLabel="Assign toolkit"
          onAssign={onAssign}
        />
      </div>

      {composioToolkitsData.orgToolkits.length === 0 ? (
        <p className="type-body text-xs text-muted-foreground">
          Ask an org admin to enable apps on Integrations first.
        </p>
      ) : assignedComposioToolkits.length === 0 ? null : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {assignedComposioToolkits.map(({ toolkit, userConnection }) => (
            <li
              key={toolkit.id}
              className="flex items-center justify-between gap-2 px-3 py-2 first:rounded-t-md last:rounded-b-md"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium leading-tight text-foreground">
                  {toolkit.displayName}
                </p>
                <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                  Org: {toolkit.status}
                  {userConnection?.status === "connected"
                    ? " · You: connected"
                    : " · You: not connected — connect on Integrations"}
                  {toolkit.cachedTools.length > 0
                    ? ` · ${toolkit.cachedTools.length} tool${toolkit.cachedTools.length === 1 ? "" : "s"}`
                    : ""}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="shrink-0 text-muted-foreground/60 hover:text-destructive"
                disabled={busy}
                aria-label={`Remove ${toolkit.displayName}`}
                onClick={() =>
                  onRemove({ kind: "composio", id: toolkit.id, name: toolkit.displayName })
                }
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
