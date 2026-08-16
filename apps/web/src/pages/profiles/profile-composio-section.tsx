import { Delete02Icon } from "hugeicons-react";
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
            <p className="type-body mt-1 text-xs">
              {assignedComposioToolkits.length} assigned
            </p>
          ) : null}
        </div>
        <ComposioToolkitAssignPicker
          buttonLabel="Assign toolkit"
          disabled={busy}
          onAssign={onAssign}
          toolkits={availableComposioToolkits}
        />
      </div>

      {composioToolkitsData.orgToolkits.length === 0 ? (
        <p className="type-body text-muted-foreground text-xs">
          Ask an org admin to enable apps on Integrations first.
        </p>
      ) : assignedComposioToolkits.length === 0 ? null : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {assignedComposioToolkits.map(
            ({ toolkit, userConnection, assignment }) => (
              <li
                className="flex items-center justify-between gap-2 px-3 py-2 first:rounded-t-md last:rounded-b-md"
                key={toolkit.id}
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground text-sm leading-tight">
                    {toolkit.displayName}
                  </p>
                  <p className="mt-0.5 text-muted-foreground text-xs leading-snug">
                    Org: {toolkit.status}
                    {userConnection?.status === "connected"
                      ? " · You: connected"
                      : " · You: not connected — connect on Integrations"}
                    {toolkit.cachedTools.length > 0
                      ? ` · ${toolkit.cachedTools.length} action${toolkit.cachedTools.length === 1 ? "" : "s"}`
                      : ""}
                    {assignment.allowedActions &&
                    assignment.allowedActions.length > 0
                      ? ` · ${assignment.allowedActions.length} allowed`
                      : toolkit.cachedTools.length > 0
                        ? " · all actions searchable"
                        : ""}
                  </p>
                </div>
                <Button
                  aria-label={`Remove ${toolkit.displayName}`}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  disabled={busy}
                  onClick={() =>
                    onRemove({
                      id: toolkit.id,
                      kind: "composio",
                      name: toolkit.displayName,
                    })
                  }
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <Delete02Icon aria-hidden className="size-4" />
                </Button>
              </li>
            )
          )}
        </ul>
      )}
    </div>
  );
}
