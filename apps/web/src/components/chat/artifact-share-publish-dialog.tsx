import { CheckIcon, CopyIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { PublishIntent } from "@/components/chat/use-artifact-share-controls";

type ArtifactSharePublishDialogProps = {
  open: boolean;
  artifactPath: string;
  publishIntent: PublishIntent;
  publishedUrl: string | null;
  publishWarning: string | null;
  publishDialogSucceeded: boolean;
  isShared: boolean;
  copied: boolean;
  publishPending: boolean;
  revokePending: boolean;
  onOpenChange: (open: boolean) => void;
  onClose: () => void;
  onCopyLink: (url: string) => void;
  onRefreshFromDialog: () => void;
  onRevoke: () => void;
  onRotateLink: () => void;
  onConfirmPublish: () => void;
};

export function ArtifactSharePublishDialog({
  open,
  artifactPath,
  publishIntent,
  publishedUrl,
  publishWarning,
  publishDialogSucceeded,
  isShared,
  copied,
  publishPending,
  revokePending,
  onOpenChange,
  onClose,
  onCopyLink,
  onRefreshFromDialog,
  onRevoke,
  onRotateLink,
  onConfirmPublish,
}: ArtifactSharePublishDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {publishDialogSucceeded ? (
          <ArtifactShareSuccessView
            publishIntent={publishIntent}
            publishedUrl={publishedUrl}
            publishWarning={publishWarning}
            isShared={isShared}
            copied={copied}
            revokePending={revokePending}
            onCopyLink={onCopyLink}
            onRefreshFromDialog={onRefreshFromDialog}
            onRevoke={onRevoke}
            onClose={onClose}
          />
        ) : publishIntent === "recover" ? (
          <ArtifactShareRecoverView
            publishPending={publishPending}
            revokePending={revokePending}
            onClose={onClose}
            onRotateLink={onRotateLink}
          />
        ) : (
          <ArtifactShareConfirmView
            artifactPath={artifactPath}
            publishIntent={publishIntent}
            publishPending={publishPending}
            onClose={onClose}
            onConfirmPublish={onConfirmPublish}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ArtifactShareSuccessView({
  publishIntent,
  publishedUrl,
  publishWarning,
  isShared,
  copied,
  revokePending,
  onCopyLink,
  onRefreshFromDialog,
  onRevoke,
  onClose,
}: {
  publishIntent: PublishIntent;
  publishedUrl: string | null;
  publishWarning: string | null;
  isShared: boolean;
  copied: boolean;
  revokePending: boolean;
  onCopyLink: (url: string) => void;
  onRefreshFromDialog: () => void;
  onRevoke: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {publishIntent === "view"
            ? "Shared artifact link"
            : publishIntent === "refresh"
              ? "Snapshot updated"
              : "Artifact published"}
        </DialogTitle>
        <DialogDescription>
          Anyone with this link can view the shared snapshot without logging in.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Input
            readOnly
            value={publishedUrl ?? ""}
            aria-label="Published artifact share link"
            className="font-mono text-xs"
            onFocus={(event) => event.currentTarget.select()}
          />
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Copy share link"
            onClick={() => publishedUrl && void onCopyLink(publishedUrl)}
          >
            {copied ? (
              <CheckIcon className="size-3.5" aria-hidden />
            ) : (
              <CopyIcon className="size-3.5" aria-hidden />
            )}
          </Button>
        </div>
        {publishWarning ? (
          <p className="text-xs text-muted-foreground">{publishWarning}</p>
        ) : null}
      </div>
      <DialogFooter className={cn(isShared && "sm:justify-between")}>
        {isShared ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={onRefreshFromDialog}>
              Update snapshot
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void onRevoke()}
              disabled={revokePending}
            >
              {revokePending ? <Spinner className="size-4" /> : null}
              Revoke
            </Button>
          </div>
        ) : null}
        <Button type="button" onClick={onClose}>
          Done
        </Button>
      </DialogFooter>
    </>
  );
}

function ArtifactShareRecoverView({
  publishPending,
  revokePending,
  onClose,
  onRotateLink,
}: {
  publishPending: boolean;
  revokePending: boolean;
  onClose: () => void;
  onRotateLink: () => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Share link not saved here</DialogTitle>
        <DialogDescription>
          This artifact is published, but this browser does not have the link. Nakama only shows
          the full URL once at publish time and stores a hash on the server, so it cannot be
          looked up again later. Rotate the link to mint a new URL — the previous link will stop
          working.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          onClick={() => void onRotateLink()}
          disabled={publishPending || revokePending}
        >
          {publishPending || revokePending ? <Spinner className="size-4" /> : null}
          Rotate link
        </Button>
      </DialogFooter>
    </>
  );
}

function ArtifactShareConfirmView({
  artifactPath,
  publishIntent,
  publishPending,
  onClose,
  onConfirmPublish,
}: {
  artifactPath: string;
  publishIntent: PublishIntent;
  publishPending: boolean;
  onClose: () => void;
  onConfirmPublish: () => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {publishIntent === "refresh" ? "Update shared snapshot?" : "Publish artifact link?"}
        </DialogTitle>
        <DialogDescription>
          {publishIntent === "refresh" ? (
            <>
              Replace the published snapshot with the current contents of{" "}
              <span className="font-medium text-foreground">{artifactPath}</span>. The share link
              stays the same.
            </>
          ) : (
            <>
              Create a public snapshot of{" "}
              <span className="font-medium text-foreground">{artifactPath}</span> that anyone can
              open without logging in. Later edits to the live file will not change what is shared.
            </>
          )}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          onClick={() => void onConfirmPublish()}
          disabled={publishPending}
        >
          {publishPending ? <Spinner className="size-4" /> : null}
          {publishIntent === "refresh" ? "Update snapshot" : "Publish"}
        </Button>
      </DialogFooter>
    </>
  );
}
