import { useEffect, useRef, useState } from "react";
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

export type PublishIntent = "publish" | "refresh" | "view" | "recover";

export function useArtifactShareControls({
  profileId,
  artifactPath,
}: {
  profileId: string;
  artifactPath: string;
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
  const busy = publishMutation.isPending || revokeMutation.isPending || statusQuery.isLoading;

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

  return {
    orgId,
    copied,
    busy,
    isShared,
    publishDialogOpen,
    publishIntent,
    publishedUrl,
    publishWarning,
    publishDialogSucceeded,
    publishMutation,
    revokeMutation,
    openPublishDialog,
    openViewShareDialog,
    openRefreshFromDialog,
    handleShareClick,
    handleRevokeFromDialog,
    closePublishDialog,
    copyLink,
    confirmPublish,
    handleCopyExisting,
    handleRotateLink,
    handleRevoke,
  };
}

export type ArtifactShareControlsState = ReturnType<typeof useArtifactShareControls>;
