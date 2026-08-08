import { ProfileCreateDialog } from "@/components/ProfileCreateDialog";
import { SkillCreateDialog } from "@/components/SkillCreateDialog";
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

export function ProfilesDialogs(state: ProfilesPageState) {
  const {
    allTools,
    createOpen,
    handleCreateOpenChange,
    setSelectedId,
    skillCreateOpen,
    setSkillCreateOpen,
    createSkillMutation,
    assignSkillMutation,
    selectedId,
    handleCreateSkill,
    busy,
    setRemoveConfirm,
    mcpCreateOpen,
    setMcpCreateOpen,
    createMcpMutation,
    assignMcpMutation,
    handleCreateMcpServer,
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

      <SkillCreateDialog
        busy={createSkillMutation.isPending || assignSkillMutation.isPending}
        onOpenChange={setSkillCreateOpen}
        onSubmit={handleCreateSkill}
        open={skillCreateOpen}
        profileId={selectedId}
      />

      <McpServerDialog
        busy={createMcpMutation.isPending || assignMcpMutation.isPending}
        onOpenChange={(open) => {
          setMcpCreateOpen(open);
        }}
        onSubmit={handleCreateMcpServer}
        open={mcpCreateOpen}
      />

      <Dialog onOpenChange={handleDeleteOpenChange} open={deleteOpen}>
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
              onClick={() => setDeleteOpen(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={() => void handleDeleteConfirm()}
              type="button"
              variant="destructive"
            >
              {deleteMutation.isPending ? (
                <Spinner className="size-4" />
              ) : (
                "Delete"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          if (!(open || busy)) {
            setRemoveConfirm(null);
          }
        }}
        open={removeConfirm !== null}
      >
        <DialogContent className="gap-6 p-6 sm:max-w-md">
          <DialogHeader className="gap-3">
            <DialogTitle>
              {removeConfirm?.kind === "mcp"
                ? "Delete MCP server?"
                : removeConfirm?.kind === "skill"
                  ? "Delete skill?"
                  : removeConfirm?.kind === "composio"
                    ? "Remove Composio toolkit?"
                    : "Delete tool?"}
            </DialogTitle>
            <DialogDescription>
              {removeConfirm?.kind === "mcp"
                ? `Delete "${removeConfirm.name}" from this profile? The server stays registered in Soul.`
                : removeConfirm?.kind === "skill"
                  ? `Delete "${removeConfirm.name}" from this profile? The skill stays available to assign again.`
                  : removeConfirm?.kind === "composio"
                    ? `Remove "${removeConfirm.name}" from this profile? The org connection stays on Integrations.`
                    : `Delete "${removeConfirm?.name}" from this profile?`}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="mx-0 -mb-2 gap-3 border-t-0 bg-transparent p-0 pt-2 pb-2 sm:justify-end">
            <Button
              disabled={busy}
              onClick={() => setRemoveConfirm(null)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={() => void handleRemoveAssignmentConfirm()}
              type="button"
              variant="destructive"
            >
              {unassignMutation.isPending ||
              unassignMcpMutation.isPending ||
              unassignSkillMutation.isPending ? (
                <Spinner className="size-4" />
              ) : (
                "Delete"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
