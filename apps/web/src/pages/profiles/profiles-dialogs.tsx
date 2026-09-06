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

function cloneProfileDescription(name?: string): string {
  if (name) {
    return `This creates a copy of ${name}.`;
  }

  return "This creates a copy of the profile.";
}

function deleteProfileDescription(name?: string, isDefault?: boolean): string {
  const defaultNote = isDefault
    ? " Another profile becomes the org default."
    : "";

  if (name) {
    return `This removes ${name} and its chat history.${defaultNote} This cannot be undone.`;
  }

  return `This removes the profile and its chat history.${defaultNote} This cannot be undone.`;
}

function removeAssignmentTitle(kind?: string): string {
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

function removeAssignmentDescription(kind?: string, name?: string): string {
  if (kind === "mcp") {
    return `Delete "${name}" from this profile? The server stays registered in Soul.`;
  }

  if (kind === "skill") {
    return `Delete "${name}" from this profile? The skill stays available to assign again.`;
  }

  if (kind === "composio") {
    return `Remove "${name}" from this profile? The org connection stays on Integrations.`;
  }

  return `Delete "${name}" from this profile?`;
}

function CloneProfileDialog({
  busy,
  cloneTargetId,
  cloneTargetName,
  isPending,
  onOpenChange,
  onConfirm,
}: {
  busy: boolean;
  cloneTargetId: string | null;
  cloneTargetName?: string;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={cloneTargetId !== null}>
      <DialogContent className="gap-6 p-6 sm:max-w-md">
        <DialogHeader className="gap-3">
          <DialogTitle>Clone profile?</DialogTitle>
          <DialogDescription>
            {cloneProfileDescription(cloneTargetName)}
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
            {isPending ? <Spinner className="size-4" /> : "Clone"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteProfileDialog({
  busy,
  open,
  deleteTargetIsDefault,
  deleteTargetName,
  isPending,
  onOpenChange,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  open: boolean;
  deleteTargetIsDefault?: boolean;
  deleteTargetName?: string;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="gap-6 p-6 sm:max-w-md">
        <DialogHeader className="gap-3">
          <DialogTitle>Delete profile?</DialogTitle>
          <DialogDescription>
            {deleteProfileDescription(deleteTargetName, deleteTargetIsDefault)}
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
            {isPending ? <Spinner className="size-4" /> : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RemoveAssignmentDialog({
  busy,
  removeConfirm,
  isPending,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  removeConfirm: ProfilesPageState["removeConfirm"];
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!(open || busy)) {
          onCancel();
        }
      }}
      open={removeConfirm !== null}
    >
      <DialogContent className="gap-6 p-6 sm:max-w-md">
        <DialogHeader className="gap-3">
          <DialogTitle>
            {removeAssignmentTitle(removeConfirm?.kind)}
          </DialogTitle>
          <DialogDescription>
            {removeAssignmentDescription(
              removeConfirm?.kind,
              removeConfirm?.name
            )}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="mx-0 -mb-2 gap-3 border-t-0 bg-transparent p-0 pt-2 pb-2 sm:justify-end">
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
            {isPending ? <Spinner className="size-4" /> : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProfilesDialogs(state: ProfilesPageState) {
  const {
    allTools,
    createOpen,
    handleCreateOpenChange,
    setSelectedId,
    importOpen,
    setImportOpen,
    handleProfileImported,
    skillCreateOpen,
    setSkillCreateOpen,
    skillInstallOpen,
    setSkillInstallOpen,
    createSkillMutation,
    installSkillMutation,
    assignSkillMutation,
    selectedId,
    handleCreateSkill,
    handleInstallSkill,
    busy,
    setRemoveConfirm,
    mcpCreateOpen,
    setMcpCreateOpen,
    createMcpMutation,
    assignMcpMutation,
    availableMcpServers,
    handleAssignMcpServer,
    handleCreateMcpServer,
    cloneTarget,
    cloneTargetId,
    cloneProfileMutation,
    handleCloneOpenChange,
    handleCloneConfirm,
    deleteOpen,
    handleDeleteOpenChange,
    setDeleteOpen,
    deleteTarget,
    deleteMutation,
    handleDeleteConfirm,
    removeConfirm,
    unassignMutation,
    unassignMcpMutation,
    unassignSkillMutation,
    handleRemoveAssignmentConfirm,
    profiles,
  } = state;
  const { navigateToNewChat } = useAppNavigation();
  const superBotProfileId = resolveSuperBotChatProfileId(profiles);
  const onAskSuperBot = superBotProfileId
    ? () => navigateToNewChat(superBotProfileId)
    : undefined;

  return (
    <>
      <ProfileCreateDialog
        onAskSuperBot={onAskSuperBot}
        onCreated={(profileId) => setSelectedId(profileId)}
        onOpenChange={handleCreateOpenChange}
        open={createOpen}
        tools={allTools}
      />

      <ProfileImportDialog
        onImported={handleProfileImported}
        onOpenChange={setImportOpen}
        open={importOpen}
      />

      <SkillCreateDialog
        busy={createSkillMutation.isPending || assignSkillMutation.isPending}
        onOpenChange={setSkillCreateOpen}
        onSubmit={handleCreateSkill}
        open={skillCreateOpen}
        profileId={selectedId}
      />

      <SkillInstallDialog
        busy={installSkillMutation.isPending}
        onOpenChange={setSkillInstallOpen}
        onSubmit={handleInstallSkill}
        open={skillInstallOpen}
        profileId={selectedId}
      />

      <McpServerDialog
        availableServers={availableMcpServers}
        busy={createMcpMutation.isPending || assignMcpMutation.isPending}
        onAssign={handleAssignMcpServer}
        onOpenChange={(open) => {
          setMcpCreateOpen(open);
        }}
        onSubmit={handleCreateMcpServer}
        open={mcpCreateOpen}
      />

      <CloneProfileDialog
        busy={busy}
        cloneTargetId={cloneTargetId}
        cloneTargetName={cloneTarget?.name}
        isPending={cloneProfileMutation.isPending}
        onConfirm={() => void handleCloneConfirm()}
        onOpenChange={handleCloneOpenChange}
      />

      <DeleteProfileDialog
        busy={busy}
        deleteTargetIsDefault={deleteTarget?.isDefault === true}
        deleteTargetName={deleteTarget?.name}
        isPending={deleteMutation.isPending}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => void handleDeleteConfirm()}
        onOpenChange={handleDeleteOpenChange}
        open={deleteOpen}
      />

      <RemoveAssignmentDialog
        busy={busy}
        isPending={
          unassignMutation.isPending ||
          unassignMcpMutation.isPending ||
          unassignSkillMutation.isPending
        }
        onCancel={() => setRemoveConfirm(null)}
        onConfirm={() => void handleRemoveAssignmentConfirm()}
        removeConfirm={removeConfirm}
      />
    </>
  );
}
