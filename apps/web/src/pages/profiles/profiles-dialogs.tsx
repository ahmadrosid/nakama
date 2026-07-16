import { ProfileCreateDialog } from "@/components/ProfileCreateDialog";
import { McpServerDialog } from "@/components/soul-tools/mcp-tab/McpServerDialog";
import { SkillCreateDialog } from "@/components/SkillCreateDialog";
import { SkillDetailDialog } from "@/components/SkillDetailDialog";
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
    detailSkillId,
    setDetailSkillId,
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
  } = state;

  return (
    <>
      <ProfileCreateDialog
        open={createOpen}
        tools={allTools}
        onOpenChange={handleCreateOpenChange}
        onCreated={(profileId) => setSelectedId(profileId)}
      />

      <SkillCreateDialog
        open={skillCreateOpen}
        busy={createSkillMutation.isPending || assignSkillMutation.isPending}
        profileId={selectedId}
        onOpenChange={setSkillCreateOpen}
        onSubmit={handleCreateSkill}
      />

      <SkillDetailDialog
        skillId={detailSkillId}
        busy={busy}
        onOpenChange={(open) => {
          if (!open) {
            setDetailSkillId(null);
          }
        }}
        onRemoveFromProfile={(skillId, skillName) => {
          setDetailSkillId(null);
          setRemoveConfirm({ kind: "skill", id: skillId, name: skillName });
        }}
      />

      <McpServerDialog
        open={mcpCreateOpen}
        busy={createMcpMutation.isPending || assignMcpMutation.isPending}
        onOpenChange={(open) => {
          setMcpCreateOpen(open);
        }}
        onSubmit={handleCreateMcpServer}
      />

      <Dialog open={deleteOpen} onOpenChange={handleDeleteOpenChange}>
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
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setDeleteOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => void handleDeleteConfirm()}
            >
              {deleteMutation.isPending ? <Spinner className="size-4" /> : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={removeConfirm !== null}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setRemoveConfirm(null);
          }
        }}
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
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setRemoveConfirm(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => void handleRemoveAssignmentConfirm()}
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
