import { EyeIcon, Loader2Icon, Share2Icon } from "lucide-react";
import { ArtifactSharePublishDialog } from "@/components/chat/artifact-share-publish-dialog";
import {
  type ArtifactShareControlsState,
  useArtifactShareControls,
} from "@/components/chat/use-artifact-share-controls";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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

function buildPublishDialog(
  share: ArtifactShareControlsState,
  artifactPath: string
) {
  return (
    <ArtifactSharePublishDialogFromState
      artifactPath={artifactPath}
      share={share}
    />
  );
}

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
  const share = useArtifactShareControls({ artifactPath, profileId });
  const publishDialog = buildPublishDialog(share, artifactPath);

  if (asMenuItem) {
    return <ArtifactShareMenuItem share={share} />;
  }

  if (compact) {
    return (
      <>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label="Share"
                disabled={share.busy || !share.orgId}
                onClick={share.handleShareClick}
                size="icon-sm"
                title="Share"
                type="button"
                variant="outline"
              >
                {share.busy ? (
                  <Loader2Icon aria-hidden className="size-3.5 animate-spin" />
                ) : (
                  <Share2Icon aria-hidden className="size-3.5" />
                )}
              </Button>
            }
          />
          <TooltipContent side="top" sideOffset={8}>
            Share
          </TooltipContent>
        </Tooltip>
        {publishDialog}
      </>
    );
  }

  return (
    <>
      <div className="inline-flex items-center gap-1">
        {share.isShared ? (
          <>
            <Button
              disabled={share.busy}
              onClick={share.openViewShareDialog}
              size="sm"
              type="button"
              variant="outline"
            >
              <EyeIcon aria-hidden className="size-3.5" />
              View
            </Button>
            <Button
              disabled={share.busy}
              onClick={() => void share.handleCopyExisting()}
              size="sm"
              type="button"
              variant="outline"
            >
              {share.copied ? "Copied" : "Copy link"}
            </Button>
            <Button
              disabled={share.busy}
              onClick={() => void share.handleRevoke()}
              size="sm"
              type="button"
              variant="ghost"
            >
              Revoke
            </Button>
          </>
        ) : (
          <Button
            disabled={share.busy || !share.orgId}
            onClick={() => share.openPublishDialog("publish")}
            size="sm"
            type="button"
            variant="outline"
          >
            {share.busy ? (
              <Loader2Icon aria-hidden className="size-3.5 animate-spin" />
            ) : (
              <Share2Icon aria-hidden className="size-3.5" />
            )}
            Publish
          </Button>
        )}
      </div>
      {publishDialog}
    </>
  );
}
