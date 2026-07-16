import { EyeIcon, Loader2Icon, Share2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { ArtifactSharePublishDialog } from "@/components/chat/artifact-share-publish-dialog";
import { useArtifactShareControls } from "@/components/chat/use-artifact-share-controls";

export function ArtifactShareControls({
  profileId,
  artifactPath,
  compact = false,
  asMenuItem = false,
}: {
  profileId: string;
  artifactPath: string;
  compact?: boolean;
  asMenuItem?: boolean;
}) {
  const share = useArtifactShareControls({ profileId, artifactPath });

  const publishDialog = (
    <ArtifactSharePublishDialog
      open={share.publishDialogOpen}
      artifactPath={artifactPath}
      publishIntent={share.publishIntent}
      publishedUrl={share.publishedUrl}
      publishWarning={share.publishWarning}
      publishDialogSucceeded={share.publishDialogSucceeded}
      isShared={share.isShared}
      copied={share.copied}
      publishPending={share.publishMutation.isPending}
      revokePending={share.revokeMutation.isPending}
      onOpenChange={(open) => {
        if (!open) {
          share.closePublishDialog();
        }
      }}
      onClose={share.closePublishDialog}
      onCopyLink={(url) => void share.copyLink(url)}
      onRefreshFromDialog={share.openRefreshFromDialog}
      onRevoke={() => void share.handleRevokeFromDialog()}
      onRotateLink={() => void share.handleRotateLink()}
      onConfirmPublish={() => void share.confirmPublish()}
    />
  );

  if (asMenuItem) {
    return (
      <>
        <DropdownMenuItem
          className="cursor-pointer"
          disabled={share.busy || !share.orgId}
          onClick={share.handleShareClick}
        >
          Share artifact
        </DropdownMenuItem>
        {publishDialog}
      </>
    );
  }

  if (compact) {
    return (
      <>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={share.busy || !share.orgId}
          onClick={share.handleShareClick}
        >
          {share.busy ? (
            <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Share2Icon className="size-3.5" aria-hidden />
          )}
          Share
        </Button>
        {publishDialog}
      </>
    );
  }

  return (
    <>
      <div className="inline-flex items-center gap-1">
        {!share.isShared ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={share.busy || !share.orgId}
            onClick={() => share.openPublishDialog("publish")}
          >
            {share.busy ? (
              <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Share2Icon className="size-3.5" aria-hidden />
            )}
            Publish
          </Button>
        ) : (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={share.busy}
              onClick={share.openViewShareDialog}
            >
              <EyeIcon className="size-3.5" aria-hidden />
              View
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={share.busy}
              onClick={() => void share.handleCopyExisting()}
            >
              {share.copied ? "Copied" : "Copy link"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={share.busy}
              onClick={() => void share.handleRevoke()}
            >
              Revoke
            </Button>
          </>
        )}
      </div>
      {publishDialog}
    </>
  );
}
