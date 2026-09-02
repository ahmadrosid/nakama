import type { SoulStackFiles } from "@nakama/core/contract";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { SoulFileEditorDialog } from "@/components/soul-tools/soul-file-editor-dialog";
import { SOUL_FILES } from "@/components/soul-tools/soul-files";
import {
  SoulTabPageState,
  SoulTabPanel,
  SoulTabShell,
} from "@/components/soul-tools/soul-tab-panel";
import { useProfilesQuery } from "@/hooks/use-app-queries";
import {
  useSoulFileQuery,
  useSoulStatusQuery,
  useWriteSoulFileMutation,
} from "@/hooks/use-resource-mutations";
import { formatError } from "@/lib/client";
import { findDefaultProfile, resolveInitialProfileId } from "@/lib/profiles";
import { cn } from "@/lib/utils";

const sectionClass = "rounded-md border border-border bg-card";

function resolveDefaultProfileId(
  profiles: Array<{ id: string }>,
  fromUrl: string | null
): string | null {
  if (profiles.length === 0) {
    return null;
  }

  if (fromUrl && profiles.some((profile) => profile.id === fromUrl)) {
    return fromUrl;
  }

  return resolveInitialProfileId(profiles);
}

function useSoulTabState(controlledProfileId?: string | null) {
  const embedded = controlledProfileId !== undefined;
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    data: profiles = [],
    error: profilesError,
    isFetching: profilesFetching,
    refetch: refetchProfiles,
  } = useProfilesQuery();
  const [internalProfileId, setProfileIdState] = useState<string | null>(null);
  const profileInitializedRef = useRef(false);
  const profileId = embedded ? controlledProfileId : internalProfileId;
  const {
    data: status = null,
    isLoading: statusLoading,
    isFetching: statusFetching,
    error: statusError,
    refetch: refetchStatus,
  } = useSoulStatusQuery(profileId);
  const [openFile, setOpenFile] = useState<keyof SoulStackFiles | null>(null);
  const {
    data: fileContent = "",
    isLoading: dialogLoading,
    error: fileError,
  } = useSoulFileQuery(profileId, openFile, openFile !== null);
  const writeSoulMutation = useWriteSoulFileMutation();
  const [editContent, setEditContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = writeSoulMutation.isPending;
  const loading = statusLoading && !status;
  const refreshing = profilesFetching || statusFetching;

  const selectedProfile =
    profiles.find((profile) => profile.id === profileId) ?? null;
  const openFileMeta = openFile
    ? SOUL_FILES.find((file) => file.key === openFile)
    : null;
  const isDirty = editContent !== savedContent;
  const isWritable = openFileMeta?.writable ?? false;

  const presentCount = useMemo(() => {
    if (!status) {
      return 0;
    }

    return SOUL_FILES.filter((file) => status.files[file.key]).length;
  }, [status]);

  const setProfileId = useCallback(
    (nextProfileId: string) => {
      setProfileIdState(nextProfileId);
      setOpenFile(null);
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          const defaultProfileId = findDefaultProfile(profiles)?.id;
          if (defaultProfileId && nextProfileId === defaultProfileId) {
            next.delete("profile");
          } else {
            next.set("profile", nextProfileId);
          }
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams, profiles]
  );

  useEffect(() => {
    if (embedded || profiles.length === 0) {
      return;
    }

    const urlProfile = searchParams.get("profile");
    const nextProfileId = resolveDefaultProfileId(profiles, urlProfile);

    if (!profileInitializedRef.current) {
      profileInitializedRef.current = true;
      setProfileIdState(nextProfileId);
      return;
    }

    setProfileIdState((current) => {
      if (
        urlProfile &&
        profiles.some((profile) => profile.id === urlProfile) &&
        urlProfile !== current
      ) {
        return urlProfile;
      }

      if (current && profiles.some((profile) => profile.id === current)) {
        return current;
      }

      return nextProfileId;
    });
  }, [embedded, profiles, searchParams]);

  useEffect(() => {
    const queryError = profilesError ?? statusError;
    if (queryError) {
      setError(formatError(queryError));
    }
  }, [profilesError, statusError]);

  useEffect(() => {
    if (fileError) {
      setDialogError(formatError(fileError));
    }
  }, [fileError]);

  useEffect(() => {
    if (openFile === null || dialogLoading) {
      return;
    }

    setEditContent(fileContent);
    setSavedContent(fileContent);
  }, [openFile, fileContent, dialogLoading]);

  function handleOpenFile(fileKey: keyof SoulStackFiles) {
    setOpenFile(fileKey);
    setEditContent("");
    setSavedContent("");
    setDialogError(null);
  }

  function handleDialogOpenChange(open: boolean) {
    if (!open) {
      setOpenFile(null);
      setDialogError(null);
    }
  }

  async function handleSave() {
    if (!(profileId && openFile && isWritable && isDirty)) {
      return;
    }

    setDialogError(null);

    try {
      await writeSoulMutation.mutateAsync({
        content: editContent,
        fileKey: openFile,
        profileId,
      });
      setSavedContent(editContent);
    } catch (err) {
      setDialogError(formatError(err));
    }
  }

  async function refresh() {
    setError(null);
    await Promise.all([refetchProfiles(), refetchStatus()]);
  }

  return {
    busy,
    dialogError,
    dialogLoading,
    editContent,
    embedded,
    error,
    handleDialogOpenChange,
    handleOpenFile,
    handleSave,
    isDirty,
    isWritable,
    loading,
    openFile,
    openFileMeta,
    presentCount,
    profileId,
    profiles,
    profilesFetching,
    refresh,
    refreshing,
    selectedProfile,
    setEditContent,
    setProfileId,
    status,
  };
}

function SoulTabGate({
  embedded,
  loading,
  profileId,
  profiles,
  profilesFetching,
  children,
}: {
  embedded: boolean;
  loading: boolean;
  profileId: string | null | undefined;
  profiles: Array<{ id: string }>;
  profilesFetching: boolean;
  children: React.ReactNode;
}) {
  if (!embedded && profiles.length === 0 && !profilesFetching) {
    return (
      <div className={cn(sectionClass, "p-8 text-muted-foreground text-sm")}>
        Create a profile first to configure prompt files.
      </div>
    );
  }

  if (embedded && !profileId) {
    return (
      <p className="text-muted-foreground text-sm">
        Select a profile to edit prompt files.
      </p>
    );
  }

  if (loading) {
    return (
      <SoulTabPageState embedded={embedded} message="Loading prompt stack…" />
    );
  }

  return children;
}

function SoulTabView({ state }: { state: ReturnType<typeof useSoulTabState> }) {
  const soulPanel = (
    <SoulTabPanel
      busy={state.busy}
      embedded={state.embedded}
      onOpenFile={state.handleOpenFile}
      onRefresh={() => void state.refresh()}
      presentCount={state.presentCount}
      refreshing={state.refreshing}
      selectedProfile={state.selectedProfile}
      status={state.status}
    />
  );

  return (
    <>
      {state.error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive text-sm">
          {state.error}
        </p>
      ) : null}

      {state.embedded ? (
        soulPanel
      ) : (
        <SoulTabShell
          busy={state.busy}
          onProfileSelect={state.setProfileId}
          onRefresh={() => void state.refresh()}
          panel={soulPanel}
          profileId={state.profileId}
          profiles={state.profiles}
          refreshing={state.refreshing}
        />
      )}

      <SoulFileEditorDialog
        busy={state.busy}
        dialogError={state.dialogError}
        dialogLoading={state.dialogLoading}
        editContent={state.editContent}
        isDirty={state.isDirty}
        isWritable={state.isWritable}
        onEditContentChange={state.setEditContent}
        onOpenChange={state.handleDialogOpenChange}
        onSave={() => void state.handleSave()}
        open={state.openFile !== null}
        openFile={state.openFile}
        openFileMeta={state.openFileMeta}
        status={state.status}
      />
    </>
  );
}

export function SoulTab({
  profileId: controlledProfileId,
}: {
  profileId?: string | null;
} = {}) {
  const state = useSoulTabState(controlledProfileId);

  return (
    <SoulTabGate
      embedded={state.embedded}
      loading={state.loading && !state.status}
      profileId={state.profileId}
      profiles={state.profiles}
      profilesFetching={state.profilesFetching}
    >
      <SoulTabView state={state} />
    </SoulTabGate>
  );
}
