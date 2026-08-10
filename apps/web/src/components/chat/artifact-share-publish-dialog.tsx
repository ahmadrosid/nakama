import { CheckmarkCircle01Icon, Copy01Icon } from "hugeicons-react";
import type { PublishIntent } from "@/components/chat/use-artifact-share-controls";
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
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        {publishDialogSucceeded ? (
          <ArtifactShareSuccessView
            copied={copied}
            isShared={isShared}
            onClose={onClose}
            onCopyLink={onCopyLink}
            onRefreshFromDialog={onRefreshFromDialog}
            onRevoke={onRevoke}
            publishedUrl={publishedUrl}
            publishIntent={publishIntent}
            publishWarning={publishWarning}
            revokePending={revokePending}
          />
        ) : publishIntent === "recover" ? (
          <ArtifactShareRecoverView
            onClose={onClose}
            onRotateLink={onRotateLink}
            publishPending={publishPending}
            revokePending={revokePending}
          />
        ) : (
          <ArtifactShareConfirmView
            artifactPath={artifactPath}
            onClose={onClose}
            onConfirmPublish={onConfirmPublish}
            publishIntent={publishIntent}
            publishPending={publishPending}
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
            aria-label="Published artifact share link"
            className="font-mono text-xs"
            onFocus={(event) => event.currentTarget.select()}
            readOnly
            value={publishedUrl ?? ""}
          />
          <Button
            aria-label="Copy share link"
            onClick={() => publishedUrl && void onCopyLink(publishedUrl)}
            size="icon-sm"
            type="button"
            variant="outline"
          >
            {copied ? (
              <CheckmarkCircle01Icon aria-hidden className="size-3.5" />
            ) : (
              <Copy01Icon aria-hidden className="size-3.5" />
            )}
          </Button>
        </div>
        {publishWarning ? (
          <p className="text-muted-foreground text-xs">{publishWarning}</p>
        ) : null}
      </div>
      <DialogFooter className={cn(isShared && "sm:justify-between")}>
        {isShared ? (
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={onRefreshFromDialog}
              type="button"
              variant="outline"
            >
              Update snapshot
            </Button>
            <Button
              disabled={revokePending}
              onClick={() => void onRevoke()}
              type="button"
              variant="destructive"
            >
              {revokePending ? <Spinner className="size-4" /> : null}
              Revoke
            </Button>
          </div>
        ) : null}
        <Button onClick={onClose} type="button">
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
          This artifact is published, but this browser does not have the link.
          Nakama only shows the full URL once at publish time and stores a hash
          on the server, so it cannot be looked up again later. Rotate the link
          to mint a new URL — the previous link will stop working.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button onClick={onClose} type="button" variant="outline">
          Cancel
        </Button>
        <Button
          disabled={publishPending || revokePending}
          onClick={() => void onRotateLink()}
          type="button"
        >
          {publishPending || revokePending ? (
            <Spinner className="size-4" />
          ) : null}
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
          {publishIntent === "refresh"
            ? "Update shared snapshot?"
            : "Publish artifact link?"}
        </DialogTitle>
        <DialogDescription className="min-w-0 max-w-full break-words">
          {publishIntent === "refresh" ? (
            <>
              Replace the published snapshot with the current contents of{" "}
              <span className="break-all font-medium text-foreground">
                {artifactPath}
              </span>
              . The share link stays the same.
            </>
          ) : (
            <>
              Create a public snapshot of{" "}
              <span className="break-all font-medium text-foreground">
                {artifactPath}
              </span>{" "}
              that anyone can open without logging in. Later edits to the live
              file will not change what is shared.
            </>
          )}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button onClick={onClose} type="button" variant="outline">
          Cancel
        </Button>
        <Button
          disabled={publishPending}
          onClick={() => void onConfirmPublish()}
          type="button"
        >
          {publishPending ? <Spinner className="size-4" /> : null}
          {publishIntent === "refresh" ? "Update snapshot" : "Publish"}
        </Button>
      </DialogFooter>
    </>
  );
}
