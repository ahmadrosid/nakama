import { CheckIcon, LinkIcon, Loader2Icon, Share2Icon, UnlinkIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  const storedShareIdRef = useRef<string | null>(null);

  const statusQuery = useArtifactShareStatusQuery(profileId, artifactPath, orgId);
  const publishMutation = usePublishArtifactShareMutation();
  const revokeMutation = useRevokeArtifactShareMutation();

  const shareUrl = storedUrl;
  const isShared = Boolean(statusQuery.data?.active || storedUrl);

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

  async function copyLink(url: string) {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    toast("Share link copied");
  }

  async function handlePublish() {
    if (!orgId) {
      return;
    }

    try {
      const result = await publishMutation.mutateAsync({ profileId, path: artifactPath });
      if (result.shareUrl) {
        writeStoredArtifactShare({
          orgId,
          profileId,
          artifactPath,
          shareId: result.id,
          shareUrl: result.shareUrl,
        });
        setStoredUrl(result.shareUrl);
        storedShareIdRef.current = result.id;
        await copyLink(result.shareUrl);
        return;
      }

      if (result.refreshed && shareUrl) {
        toast("Shared snapshot updated");
        return;
      }

      if (!result.webPublicUrlConfigured && result.sharePath) {
        const fallback = `${window.location.origin}${result.sharePath}`;
        writeStoredArtifactShare({
          orgId,
          profileId,
          artifactPath,
          shareId: result.id,
          shareUrl: fallback,
        });
        setStoredUrl(fallback);
        storedShareIdRef.current = result.id;
        await copyLink(fallback);
        toast("Set Web Public URL in Settings for external sharing.");
        return;
      }

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

    toast("Link unavailable — publish again to rotate.");
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

  if (compact) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button type="button" variant="outline" size="sm" disabled={busy || !orgId}>
              {busy ? (
                <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Share2Icon className="size-3.5" aria-hidden />
              )}
              Share
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="min-w-44">
          {!isShared ? (
            <DropdownMenuItem className="cursor-pointer" onClick={() => void handlePublish()}>
              Publish link
            </DropdownMenuItem>
          ) : (
            <>
              <DropdownMenuItem className="cursor-pointer" onClick={() => void handleCopyExisting()}>
                {copied ? (
                  <span className="inline-flex items-center gap-1.5">
                    <CheckIcon className="size-3.5" aria-hidden />
                    Copied
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <LinkIcon className="size-3.5" aria-hidden />
                    Copy link
                  </span>
                )}
              </DropdownMenuItem>
              <DropdownMenuItem className="cursor-pointer" onClick={() => void handlePublish()}>
                Update snapshot
              </DropdownMenuItem>
              <DropdownMenuItem className="cursor-pointer" onClick={() => void handleRevoke()}>
                <span className="inline-flex items-center gap-1.5 text-destructive">
                  <UnlinkIcon className="size-3.5" aria-hidden />
                  Revoke
                </span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <div className="inline-flex items-center gap-1">
      {!isShared ? (
        <Button type="button" variant="outline" size="sm" disabled={busy || !orgId} onClick={() => void handlePublish()}>
          {busy ? <Loader2Icon className="size-3.5 animate-spin" aria-hidden /> : <Share2Icon className="size-3.5" aria-hidden />}
          Publish
        </Button>
      ) : (
        <>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void handleCopyExisting()}>
            {copied ? "Copied" : "Copy link"}
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void handleRevoke()}>
            Revoke
          </Button>
        </>
      )}
    </div>
  );
}
