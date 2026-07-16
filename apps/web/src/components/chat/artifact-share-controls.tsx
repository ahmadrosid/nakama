import {
  CheckIcon,
  CopyIcon,
  EyeIcon,
  Loader2Icon,
  Share2Icon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
import { useAuth } from "@/context/use-auth";
import {
  useArtifactShareStatusQuery,
  usePublishArtifactShareMutation,
  useRevokeArtifactShareMutation,
} from "@/hooks/use-resource-mutations";
import { formatError } from "@/lib/client";
import {
  clearStoredArtifactShare,
  readStoredArtifactShare,
  writeStoredArtifactShare,
} from "@/lib/artifact-share-storage";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

type PublishIntent = "publish" | "refresh" | "view" | "recover";

export function ArtifactShareControls({
  profileId,
  artifactPath,
  compact = false,
}: {
  profileId: string;
  artifactPath: string;
  compact?: boolean;
}) {
  const { activeOrg } = useAuth();
  const orgId = activeOrg?.id ?? "";
  const [copied, setCopied] = useState(false);
  const [storedUrl, setStoredUrl] = useState<string | null>(null);
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [publishIntent, setPublishIntent] = useState<PublishIntent>("publish");
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [publishWarning, setPublishWarning] = useState<string | null>(null);
  const storedShareIdRef = useRef<string | null>(null);

  const statusQuery = useArtifactShareStatusQuery(profileId, artifactPath, orgId);
  const publishMutation = usePublishArtifactShareMutation();
  const revokeMutation = useRevokeArtifactShareMutation();

  const shareUrl = storedUrl;
  const isShared = Boolean(statusQuery.data?.active || storedUrl);
  const publishDialogSucceeded = publishedUrl !== null;

  useEffect(() => {
    if (!orgId) {
      return;
    }

    const stored = readStoredArtifactShare({ orgId, profileId, artifactPath });
    setStoredUrl(stored?.shareUrl ?? null);
    storedShareIdRef.current = stored?.shareId ?? null;
  }, [orgId, profileId, artifactPath, statusQuery.dataUpdatedAt]);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  function openPublishDialog(intent: Exclude<PublishIntent, "view" | "recover">) {
    setPublishIntent(intent);
    setPublishedUrl(null);
    setPublishWarning(null);
    setPublishDialogOpen(true);
  }

  function openViewShareDialog() {
    if (shareUrl) {
      setPublishIntent("view");
      setPublishedUrl(shareUrl);
      setPublishWarning(null);
      setPublishDialogOpen(true);
      return;
    }

    if (isShared) {
      setPublishIntent("recover");
      setPublishedUrl(null);
      setPublishWarning(null);
      setPublishDialogOpen(true);
      return;
    }

    toast("Publish this artifact to create a share link.");
  }

  function openRefreshFromDialog() {
    setPublishIntent("refresh");
    setPublishedUrl(null);
    setPublishWarning(null);
  }

  function handleShareClick() {
    if (isShared) {
      openViewShareDialog();
      return;
    }

    openPublishDialog("publish");
  }

  async function handleRevokeFromDialog() {
    await handleRevoke();
    closePublishDialog();
  }

  function closePublishDialog() {
    setPublishDialogOpen(false);
    setPublishedUrl(null);
    setPublishWarning(null);
  }

  async function copyLink(url: string) {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    toast("Share link copied");
  }

  function persistShareUrl(shareId: string, url: string) {
    writeStoredArtifactShare({
      orgId,
      profileId,
      artifactPath,
      shareId,
      shareUrl: url,
    });
    setStoredUrl(url);
    storedShareIdRef.current = shareId;
  }

  async function confirmPublish() {
    if (!orgId) {
      return;
    }

    try {
      const result = await publishMutation.mutateAsync({ profileId, path: artifactPath });
      let nextUrl: string | null = null;
      let warning: string | null = null;

      if (result.shareUrl) {
        nextUrl = result.shareUrl;
        persistShareUrl(result.id, result.shareUrl);
      } else if (!result.webPublicUrlConfigured && result.sharePath) {
        nextUrl = `${window.location.origin}${result.sharePath}`;
        persistShareUrl(result.id, nextUrl);
        warning = "Set Web Public URL in Settings for external sharing.";
      } else if (result.refreshed && shareUrl) {
        nextUrl = shareUrl;
      }

      if (nextUrl) {
        setPublishedUrl(nextUrl);
        setPublishWarning(warning);
        return;
      }

      closePublishDialog();
      toast(result.refreshed ? "Shared snapshot updated" : "Artifact published");
    } catch (error) {
      toast(formatError(error));
    }
  }

  async function handleCopyExisting() {
    if (shareUrl) {
      await copyLink(shareUrl);
      return;
    }

    if (isShared) {
      openViewShareDialog();
      return;
    }

    toast("Publish this artifact to create a share link.");
  }

  async function handleRotateLink() {
    const shareId = statusQuery.data?.id ?? storedShareIdRef.current;
    if (!orgId || !shareId) {
      return;
    }

    try {
      await revokeMutation.mutateAsync({ profileId, shareId, path: artifactPath });
      clearStoredArtifactShare({ orgId, profileId, artifactPath });
      setStoredUrl(null);
      storedShareIdRef.current = null;

      const result = await publishMutation.mutateAsync({ profileId, path: artifactPath });
      let nextUrl: string | null = null;
      let warning: string | null = null;

      if (result.shareUrl) {
        nextUrl = result.shareUrl;
        persistShareUrl(result.id, result.shareUrl);
      } else if (!result.webPublicUrlConfigured && result.sharePath) {
        nextUrl = `${window.location.origin}${result.sharePath}`;
        persistShareUrl(result.id, nextUrl);
        warning = "Set Web Public URL in Settings for external sharing.";
      }

      if (nextUrl) {
        setPublishIntent("view");
        setPublishedUrl(nextUrl);
        setPublishWarning(warning);
        return;
      }

      closePublishDialog();
      toast("New share link created");
    } catch (error) {
      toast(formatError(error));
    }
  }

  async function handleRevoke() {
    const shareId = statusQuery.data?.id ?? storedShareIdRef.current;
    if (!orgId || !shareId) {
      return;
    }

    try {
      await revokeMutation.mutateAsync({ profileId, shareId, path: artifactPath });
      clearStoredArtifactShare({ orgId, profileId, artifactPath });
      setStoredUrl(null);
      storedShareIdRef.current = null;
      toast("Share link revoked");
    } catch (error) {
      toast(formatError(error));
    }
  }

  const busy = publishMutation.isPending || revokeMutation.isPending || statusQuery.isLoading;

  const publishDialog = (
    <Dialog
      open={publishDialogOpen}
      onOpenChange={(open) => {
        if (!open) {
          closePublishDialog();
        }
      }}
    >
      <DialogContent>
        {publishDialogSucceeded ? (
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
                  onClick={() => publishedUrl && void copyLink(publishedUrl)}
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
                  <Button type="button" variant="outline" onClick={openRefreshFromDialog}>
                    Update snapshot
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => void handleRevokeFromDialog()}
                    disabled={revokeMutation.isPending}
                  >
                    {revokeMutation.isPending ? <Spinner className="size-4" /> : null}
                    Revoke
                  </Button>
                </div>
              ) : null}
              <Button type="button" onClick={closePublishDialog}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : publishIntent === "recover" ? (
          <>
            <DialogHeader>
              <DialogTitle>Share link not saved here</DialogTitle>
              <DialogDescription>
                This artifact is published, but this browser does not have the link. Nakama only
                shows the full URL once at publish time and stores a hash on the server, so it
                cannot be looked up again later. Rotate the link to mint a new URL — the previous
                link will stop working.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closePublishDialog}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void handleRotateLink()}
                disabled={publishMutation.isPending || revokeMutation.isPending}
              >
                {publishMutation.isPending || revokeMutation.isPending ? (
                  <Spinner className="size-4" />
                ) : null}
                Rotate link
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>
                {publishIntent === "refresh" ? "Update shared snapshot?" : "Publish artifact link?"}
              </DialogTitle>
              <DialogDescription>
                {publishIntent === "refresh" ? (
                  <>
                    Replace the published snapshot with the current contents of{" "}
                    <span className="font-medium text-foreground">{artifactPath}</span>. The share
                    link stays the same.
                  </>
                ) : (
                  <>
                    Create a public snapshot of{" "}
                    <span className="font-medium text-foreground">{artifactPath}</span> that anyone
                    can open without logging in. Later edits to the live file will not change what is
                    shared.
                  </>
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closePublishDialog}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void confirmPublish()}
                disabled={publishMutation.isPending}
              >
                {publishMutation.isPending ? <Spinner className="size-4" /> : null}
                {publishIntent === "refresh" ? "Update snapshot" : "Publish"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );

  if (compact) {
    return (
      <>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || !orgId}
          onClick={handleShareClick}
        >
          {busy ? (
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
        {!isShared ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || !orgId}
            onClick={() => openPublishDialog("publish")}
          >
            {busy ? (
              <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Share2Icon className="size-3.5" aria-hidden />
            )}
            Publish
          </Button>
        ) : (
          <>
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={openViewShareDialog}>
              <EyeIcon className="size-3.5" aria-hidden />
              View
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void handleCopyExisting()}
            >
              {copied ? "Copied" : "Copy link"}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void handleRevoke()}>
              Revoke
            </Button>
          </>
        )}
      </div>
      {publishDialog}
    </>
  );
}
