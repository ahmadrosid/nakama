import type { SoulFileStatus, SoulStackFiles } from "@nakama/core/contract";
import { cn } from "@nakama/ui/utils";
import type { ReactNode } from "react";
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

function syncSoulProfileSelection({
  embedded,
  profiles,
  urlProfile,
  profileInitializedRef,
  setProfileIdState,
}: {
  embedded: boolean;
  profiles: Array<{ id: string }>;
  urlProfile: string | null;
  profileInitializedRef: { current: boolean };
  setProfileIdState: (
    value: string | null | ((current: string | null) => string | null)
  ) => void;
}) {
  if (embedded) {
    return;
  }

  if (profiles.length === 0) {
    return;
  }

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
}

async function saveSoulFile({
  profileId,
  openFile,
  isWritable,
  isDirty,
  editContent,
  writeSoulMutation,
  setDialogError,
  setSavedContent,
}: {
  profileId: string | null;
  openFile: keyof SoulStackFiles | null;
  isWritable: boolean;
  isDirty: boolean;
  editContent: string;
  writeSoulMutation: ReturnType<typeof useWriteSoulFileMutation>;
  setDialogError: (value: string | null) => void;
  setSavedContent: (value: string) => void;
}) {
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

function applySoulQueryError(
  queryError: unknown,
  setError: (value: string | null) => void
) {
  if (queryError) {
    setError(formatError(queryError));
  }
}

function applySoulFileError(
  fileError: unknown,
  setDialogError: (value: string | null) => void
) {
  if (fileError) {
    setDialogError(formatError(fileError));
  }
}

function applySoulFileContent(
  openFile: keyof SoulStackFiles | null,
  dialogLoading: boolean,
  fileContent: string,
  setEditContent: (value: string) => void,
  setSavedContent: (value: string) => void
) {
  if (openFile === null || dialogLoading) {
    return;
  }

  setEditContent(fileContent);
  setSavedContent(fileContent);
}

function presentSoulFileCount(
  status: { files: SoulFileStatus } | null
): number {
  if (!status) {
    return 0;
  }

  return SOUL_FILES.filter((file) => status.files[file.key]).length;
}

function renderSoulTabGate({
  embedded,
  profilesLength,
  profilesFetching,
  profileId,
  loading,
  status,
}: {
  embedded: boolean;
  profilesLength: number;
  profilesFetching: boolean;
  profileId: string | null | undefined;
  loading: boolean;
  status: unknown;
}): ReactNode | null {
  if (!embedded && profilesLength === 0 && !profilesFetching) {
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

  if (loading && !status) {
    return (
      <SoulTabPageState embedded={embedded} message="Loading prompt stack…" />
    );
  }

  return null;
}

function useSoulTab(controlledProfileId?: string | null) {
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

  const presentCount = useMemo(() => presentSoulFileCount(status), [status]);

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
    syncSoulProfileSelection({
      embedded,
      profileInitializedRef,
      profiles,
      setProfileIdState,
      urlProfile: searchParams.get("profile"),
    });
  }, [embedded, profiles, searchParams]);

  useEffect(() => {
    applySoulQueryError(profilesError ?? statusError, setError);
  }, [profilesError, statusError]);

  useEffect(() => {
    applySoulFileError(fileError, setDialogError);
  }, [fileError]);

  useEffect(() => {
    applySoulFileContent(
      openFile,
      dialogLoading,
      fileContent,
      setEditContent,
      setSavedContent
    );
  }, [openFile, fileContent, dialogLoading]);

  return {
    busy,
    dialogError,
    dialogLoading,
    editContent,
    embedded,
    error,
    isDirty,
    isWritable,
    loading,
    openFile,
    openFileMeta,
    presentCount,
    profileId,
    profiles,
    profilesFetching,
    refetchProfiles,
    refetchStatus,
    refreshing,
    selectedProfile,
    setDialogError,
    setEditContent,
    setError,
    setOpenFile,
    setProfileId,
    setSavedContent,
    status,
    writeSoulMutation,
  };
}

export function SoulTab({
  profileId: controlledProfileId,
}: {
  profileId?: string | null;
} = {}) {
  const tab = useSoulTab(controlledProfileId);
  const gated = renderSoulTabGate({
    embedded: tab.embedded,
    loading: tab.loading,
    profileId: tab.profileId,
    profilesFetching: tab.profilesFetching,
    profilesLength: tab.profiles.length,
    status: tab.status,
  });

  if (gated) {
    return gated;
  }

  const soulPanel = (
    <SoulTabPanel
      busy={tab.busy}
      embedded={tab.embedded}
      onOpenFile={(fileKey) => {
        tab.setOpenFile(fileKey);
        tab.setEditContent("");
        tab.setSavedContent("");
        tab.setDialogError(null);
      }}
      onRefresh={() => {
        tab.setError(null);
        void Promise.all([tab.refetchProfiles(), tab.refetchStatus()]);
      }}
      presentCount={tab.presentCount}
      refreshing={tab.refreshing}
      selectedProfile={tab.selectedProfile}
      status={tab.status}
    />
  );

  return (
    <>
      {tab.error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive text-sm">
          {tab.error}
        </p>
      ) : null}

      {tab.embedded ? (
        soulPanel
      ) : (
        <SoulTabShell
          busy={tab.busy}
          onProfileSelect={tab.setProfileId}
          onRefresh={() => {
            tab.setError(null);
            void Promise.all([tab.refetchProfiles(), tab.refetchStatus()]);
          }}
          panel={soulPanel}
          profileId={tab.profileId}
          profiles={tab.profiles}
          refreshing={tab.refreshing}
        />
      )}

      <SoulFileEditorDialog
        busy={tab.busy}
        dialogError={tab.dialogError}
        dialogLoading={tab.dialogLoading}
        editContent={tab.editContent}
        isDirty={tab.isDirty}
        isWritable={tab.isWritable}
        onEditContentChange={tab.setEditContent}
        onOpenChange={(open) => {
          if (!open) {
            tab.setOpenFile(null);
            tab.setDialogError(null);
          }
        }}
        onSave={() =>
          void saveSoulFile({
            editContent: tab.editContent,
            isDirty: tab.isDirty,
            isWritable: tab.isWritable,
            openFile: tab.openFile,
            profileId: tab.profileId ?? null,
            setDialogError: tab.setDialogError,
            setSavedContent: tab.setSavedContent,
            writeSoulMutation: tab.writeSoulMutation,
          })
        }
        open={tab.openFile !== null}
        openFile={tab.openFile}
        openFileMeta={tab.openFileMeta}
        status={tab.status}
      />
    </>
  );
}
