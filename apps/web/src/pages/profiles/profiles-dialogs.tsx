import { ProfileCreateDialog } from "@/components/ProfileCreateDialog";
import { ProfileImportDialog } from "@/components/profiles/ProfileImportDialog";
import { SkillCreateDialog } from "@/components/SkillCreateDialog";
import { SkillInstallDialog } from "@/components/SkillInstallDialog";
import { McpServerDialog } from "@/components/soul-tools/mcp-tab/McpServerDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useAppNavigation } from "@/hooks/use-app-navigation";
import { resolveSuperBotChatProfileId } from "@/lib/profiles";
import type { ProfilesPageState } from "@/pages/profiles/use-profiles-page";

function ProfilesCloneDialog({
  busy,
  cloneProfilePending,
  cloneTarget,
  cloneTargetId,
  onConfirm,
  onOpenChange,
}: {
  busy: boolean;
  cloneProfilePending: boolean;
  cloneTarget: ProfilesPageState["cloneTarget"];
  cloneTargetId: string | null;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={cloneTargetId !== null}>
      <DialogContent className="gap-6 p-6 sm:max-w-md">
        <DialogHeader className="gap-3">
          <DialogTitle>Clone profile?</DialogTitle>
          <DialogDescription>
            {cloneTarget
              ? `This creates a copy of ${cloneTarget.name}.`
              : "This creates a copy of the profile."}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="gap-3 border-t-0 bg-transparent p-0 pt-2 pb-2 sm:justify-end">
          <Button
            disabled={busy}
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button disabled={busy} onClick={onConfirm} type="button">
            {cloneProfilePending ? <Spinner className="size-4" /> : "Clone"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProfilesDeleteDialog({
  busy,
  deleteOpen,
  deletePending,
  deleteTarget,
  onConfirm,
  onOpenChange,
  onCancel,
}: {
  busy: boolean;
  deleteOpen: boolean;
  deletePending: boolean;
  deleteTarget: ProfilesPageState["deleteTarget"];
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={deleteOpen}>
      <DialogContent className="gap-6 p-6 sm:max-w-md">
        <DialogHeader className="gap-3">
          <DialogTitle>Delete profile?</DialogTitle>
          <DialogDescription>
            {deleteTarget
              ? `This removes ${deleteTarget.name} and its chat history. This cannot be undone.`
              : "This removes the profile and its chat history. This cannot be undone."}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="gap-3 border-t-0 bg-transparent p-0 pt-2 pb-2 sm:justify-end">
          <Button
            disabled={busy}
            onClick={onCancel}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            disabled={busy}
            onClick={onConfirm}
            type="button"
            variant="destructive"
          >
            {deletePending ? <Spinner className="size-4" /> : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function removeAssignmentTitle(
  kind: ProfilesPageState["removeConfirm"] extends infer T
    ? T extends { kind: infer K }
      ? K
      : never
    : never
): string {
  if (kind === "mcp") {
    return "Delete MCP server?";
  }
  if (kind === "skill") {
    return "Delete skill?";
  }
  if (kind === "composio") {
    return "Remove Composio toolkit?";
  }
  return "Delete tool?";
}

function removeAssignmentDescription(
  removeConfirm: ProfilesPageState["removeConfirm"]
): string {
  if (!removeConfirm) {
    return 'Delete "" from this profile?';
  }

  if (removeConfirm.kind === "mcp") {
    return `Delete "${removeConfirm.name}" from this profile? The server stays registered in Soul.`;
  }
  if (removeConfirm.kind === "skill") {
    return `Delete "${removeConfirm.name}" from this profile? The skill stays available to assign again.`;
  }
  if (removeConfirm.kind === "composio") {
    return `Remove "${removeConfirm.name}" from this profile? The org connection stays on Integrations.`;
  }
  return `Delete "${removeConfirm.name}" from this profile?`;
}

function ProfilesRemoveAssignmentDialog({
  busy,
  onConfirm,
  onDismiss,
  pending,
  removeConfirm,
}: {
  busy: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
  pending: boolean;
  removeConfirm: ProfilesPageState["removeConfirm"];
}) {
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!(open || busy)) {
          onDismiss();
        }
      }}
      open={removeConfirm !== null}
    >
      <DialogContent className="gap-6 p-6 sm:max-w-md">
        <DialogHeader className="gap-3">
          <DialogTitle>
            {removeConfirm
              ? removeAssignmentTitle(removeConfirm.kind)
              : "Delete tool?"}
          </DialogTitle>
          <DialogDescription>
            {removeAssignmentDescription(removeConfirm)}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="mx-0 -mb-2 gap-3 border-t-0 bg-transparent p-0 pt-2 pb-2 sm:justify-end">
          <Button
            disabled={busy}
            onClick={onDismiss}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            disabled={busy}
            onClick={onConfirm}
            type="button"
            variant="destructive"
          >
            {pending ? <Spinner className="size-4" /> : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProfilesDialogs(state: ProfilesPageState) {
  const { navigateToNewChat } = useAppNavigation();
  const superBotProfileId = resolveSuperBotChatProfileId(state.profiles);
  const onAskSuperBot = superBotProfileId
    ? () => navigateToNewChat(superBotProfileId)
    : undefined;
  const removePending =
    state.unassignMutation.isPending ||
    state.unassignMcpMutation.isPending ||
    state.unassignSkillMutation.isPending;

  return (
    <>
      <ProfileCreateDialog
        onAskSuperBot={onAskSuperBot}
        onCreated={(profileId) => state.setSelectedId(profileId)}
        onOpenChange={state.handleCreateOpenChange}
        open={state.createOpen}
        tools={state.allTools}
      />

      <ProfileImportDialog
        onImported={state.handleProfileImported}
        onOpenChange={state.setImportOpen}
        open={state.importOpen}
      />

      <SkillCreateDialog
        busy={
          state.createSkillMutation.isPending ||
          state.assignSkillMutation.isPending
        }
        onOpenChange={state.setSkillCreateOpen}
        onSubmit={state.handleCreateSkill}
        open={state.skillCreateOpen}
        profileId={state.selectedId}
      />

      <SkillInstallDialog
        busy={state.installSkillMutation.isPending}
        onOpenChange={state.setSkillInstallOpen}
        onSubmit={state.handleInstallSkill}
        open={state.skillInstallOpen}
        profileId={state.selectedId}
      />

      <McpServerDialog
        availableServers={state.availableMcpServers}
        busy={
          state.createMcpMutation.isPending || state.assignMcpMutation.isPending
        }
        onAssign={state.handleAssignMcpServer}
        onOpenChange={(open) => {
          state.setMcpCreateOpen(open);
        }}
        onSubmit={state.handleCreateMcpServer}
        open={state.mcpCreateOpen}
      />

      <ProfilesCloneDialog
        busy={state.busy}
        cloneProfilePending={state.cloneProfileMutation.isPending}
        cloneTarget={state.cloneTarget}
        cloneTargetId={state.cloneTargetId}
        onConfirm={() => void state.handleCloneConfirm()}
        onOpenChange={state.handleCloneOpenChange}
      />

      <ProfilesDeleteDialog
        busy={state.busy}
        deleteOpen={state.deleteOpen}
        deletePending={state.deleteMutation.isPending}
        deleteTarget={state.deleteTarget}
        onCancel={() => state.setDeleteOpen(false)}
        onConfirm={() => void state.handleDeleteConfirm()}
        onOpenChange={state.handleDeleteOpenChange}
      />

      <ProfilesRemoveAssignmentDialog
        busy={state.busy}
        onConfirm={() => void state.handleRemoveAssignmentConfirm()}
        onDismiss={() => state.setRemoveConfirm(null)}
        pending={removePending}
        removeConfirm={state.removeConfirm}
      />
    </>
  );
}
