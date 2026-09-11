import { DropdownMenuItem } from "@nakama/ui/dropdown-menu";
import { Share04Icon } from "hugeicons-react";
import { ArtifactSharePublishDialog } from "@/components/chat/artifact-share-publish-dialog";
import type { ArtifactShareControlsState } from "@/components/chat/use-artifact-share-controls";

export function ArtifactShareMenuItem({
  share,
}: {
  share: ArtifactShareControlsState;
}) {
  return (
    <DropdownMenuItem
      className="cursor-pointer"
      disabled={share.busy || !share.orgId}
      onClick={share.handleShareClick}
    >
      <Share04Icon aria-hidden />
      Share artifact
    </DropdownMenuItem>
  );
}

export function ArtifactSharePublishDialogFromState({
  share,
  artifactPath,
}: {
  share: ArtifactShareControlsState;
  artifactPath: string;
}) {
  return (
    <ArtifactSharePublishDialog
      artifactPath={artifactPath}
      copied={share.copied}
      isShared={share.isShared}
      onClose={share.closePublishDialog}
      onConfirmPublish={() => void share.confirmPublish()}
      onCopyLink={(url) => void share.copyLink(url)}
      onOpenChange={(open) => {
        if (!open) {
          share.closePublishDialog();
        }
      }}
      onRefreshFromDialog={share.openRefreshFromDialog}
      onRevoke={() => void share.handleRevokeFromDialog()}
      onRotateLink={() => void share.handleRotateLink()}
      open={share.publishDialogOpen}
      publishDialogSucceeded={share.publishDialogSucceeded}
      publishedUrl={share.publishedUrl}
      publishIntent={share.publishIntent}
      publishPending={share.publishMutation.isPending}
      publishWarning={share.publishWarning}
      revokePending={share.revokeMutation.isPending}
    />
  );
}
