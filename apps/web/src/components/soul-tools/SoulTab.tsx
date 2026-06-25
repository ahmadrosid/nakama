import type { SoulStackFiles } from "@tinyclaw/core/contract";
import {
  CheckIcon,
  ChevronRightIcon,
  CircleIcon,
  FileTextIcon,
  FolderIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useProfilesQuery } from "@/hooks/use-app-queries";
import {
  useSoulFileQuery,
  useSoulStatusQuery,
  useWriteSoulFileMutation,
} from "@/hooks/use-resource-mutations";
import { findDefaultProfile, resolveInitialProfileId } from "@/lib/profiles";
import { cn } from "@/lib/utils";
import { formatError } from "@/lib/client";

const sectionClass = "rounded-md border border-border bg-card";

const SOUL_FILES = [
  {
    key: "soul" as const,
    label: "SOUL.md",
    description: "Identity, worldview, and opinions",
    writable: true,
  },
  {
    key: "style" as const,
    label: "STYLE.md",
    description: "Voice, tone, and formatting",
    writable: true,
  },
  {
    key: "instructions" as const,
    label: "INSTRUCTIONS.md",
    description: "Operating instructions and workflows",
    writable: true,
  },
  {
    key: "memory" as const,
    label: "MEMORY.md",
    description: "Continuity and context to carry forward",
    writable: true,
  },
  {
    key: "examples" as const,
    label: "examples/",
    description: "Calibration examples (read-only aggregate)",
    writable: false,
  },
] satisfies Array<{
  key: keyof SoulStackFiles;
  label: string;
  description: string;
  writable: boolean;
}>;

function resolveDefaultProfileId(
  profiles: Array<{ id: string }>,
  fromUrl: string | null,
): string | null {
  if (profiles.length === 0) {
    return null;
  }

  if (fromUrl && profiles.some((profile) => profile.id === fromUrl)) {
    return fromUrl;
  }

  return resolveInitialProfileId(profiles);
}

export function SoulTab({ profileId: controlledProfileId }: { profileId?: string | null } = {}) {
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

  const selectedProfile = profiles.find((profile) => profile.id === profileId) ?? null;
  const openFileMeta = openFile ? SOUL_FILES.find((file) => file.key === openFile) : null;
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
        { replace: true },
      );
    },
    [setSearchParams],
  );

  useEffect(() => {
    if (embedded) {
      return;
    }

    const nextProfileId = resolveDefaultProfileId(profiles, searchParams.get("profile"));

    if (!profileInitializedRef.current) {
      profileInitializedRef.current = true;
      setProfileIdState(nextProfileId);
      return;
    }

    if (internalProfileId && profiles.some((profile) => profile.id === internalProfileId)) {
      return;
    }

    setProfileIdState(nextProfileId);
  }, [embedded, profiles, internalProfileId, searchParams]);

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
    if (!profileId || !openFile || !isWritable || !isDirty) {
      return;
    }

    setDialogError(null);

    try {
      await writeSoulMutation.mutateAsync({
        profileId,
        fileKey: openFile,
        content: editContent,
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

  if (!embedded && profiles.length === 0 && !profilesFetching) {
    return (
      <div className={cn(sectionClass, "p-8 text-sm text-muted-foreground")}>
        Create a profile first to configure soul files.
      </div>
    );
  }

  if (embedded && !profileId) {
    return (
      <p className="text-sm text-muted-foreground">Select a profile to edit soul files.</p>
    );
  }

  if (loading && !status) {
    return <PageState message="Loading soul stack…" embedded={embedded} />;
  }

  const soulPanel = (
    <div className={embedded ? undefined : "min-w-0 p-4 sm:p-5"}>
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {!embedded ? (
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="type-section-title">{selectedProfile?.name ?? "Profile soul"}</h2>
              {selectedProfile?.soulActive ? (
                <span className="scope-badge scope-badge-active">active</span>
              ) : null}
            </div>
          ) : null}
          <p className={cn("type-body text-xs", !embedded && "mt-1")}>
            Profile soul · one stack per bot
          </p>
          {status ? (
            <p
              className="type-code mt-2 truncate text-muted-foreground"
              title={status.directory}
            >
              {status.directory}
            </p>
          ) : null}
        </div>

        <div className={cn("flex shrink-0 items-center gap-2", !embedded && "hidden lg:flex")}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || refreshing}
            onClick={() => void refresh()}
          >
            {refreshing ? (
              <Spinner className="size-4" />
            ) : (
              <RefreshCwIcon className="size-4" aria-hidden />
            )}
            Refresh
          </Button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground tabular-nums">
          {status
            ? `${presentCount} of ${SOUL_FILES.length} files present`
            : "Checking files…"}
        </p>
        <p className="text-xs text-muted-foreground lg:hidden">
          Tap a file to view or edit
        </p>
      </div>

      <ul className="divide-y divide-border rounded-md border border-border">
        {SOUL_FILES.map((file) => (
          <FileStatusListItem
            key={file.key}
            label={file.label}
            description={file.description}
            writable={file.writable}
            present={status?.files[file.key] ?? false}
            onClick={() => handleOpenFile(file.key)}
          />
        ))}
      </ul>

      {!embedded ? (
        <div className="type-body mt-5 rounded-md border border-border bg-muted/40 p-3 text-xs lg:hidden dark:bg-muted/30">
          <p className="font-medium text-foreground">How it works</p>
          <p className="mt-2">
            Soul files shape the agent&apos;s identity and voice. Start a new chat session
            after editing so changes take effect.
          </p>
        </div>
      ) : null}
    </div>
  );

  return (
    <>
      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {embedded ? (
        soulPanel
      ) : (
        <section className={cn(sectionClass, "overflow-hidden")}>
          <div className="flex flex-wrap items-center gap-3 border-b border-border p-4 lg:hidden">
            <Select
              value={profileId ?? undefined}
              disabled={busy || refreshing || !profileId}
              onValueChange={(value) => {
                if (value) {
                  setProfileId(String(value));
                }
              }}
            >
              <SelectTrigger className="min-w-0 flex-1" aria-label="Profile">
                <SelectValue placeholder="Select profile">
                  {profiles.find((profile) => profile.id === profileId)?.name}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {profiles.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>
                    <span className="flex items-center gap-2">
                      <ProfileAvatar profile={profile} size="sm" />
                      <span>{profile.name}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={busy || refreshing}
                aria-label="Refresh soul stack"
                onClick={() => void refresh()}
              >
                {refreshing ? (
                  <Spinner className="size-4" />
                ) : (
                  <RefreshCwIcon className="size-4" aria-hidden />
                )}
              </Button>
            </div>
          </div>

          <div className="grid gap-0 lg:grid-cols-[240px_minmax(0,1fr)]">
            <aside className="hidden border-b border-border p-4 lg:block lg:border-r lg:border-b-0">
              <div className="mb-4">
                <h2 className="type-section-title">Profiles</h2>
                <p className="type-body mt-1 text-xs">
                  Each profile has its own soul stack under ~/.tinyclaw/profiles/.
                </p>
              </div>

              <div className="max-h-[min(40vh,320px)] space-y-2 overflow-y-auto pr-1 lg:max-h-none">
                {profiles.map((profile) => (
                  <ScopeButton
                    key={profile.id}
                    active={profile.id === profileId}
                    title={profile.name}
                    subtitle={profile.soulActive ? "soul active" : "soul inactive"}
                    activeLabel={profile.soulActive ? "active" : undefined}
                    leading={<ProfileAvatar profile={profile} size="sm" />}
                    onClick={() => setProfileId(profile.id)}
                  />
                ))}
              </div>
            </aside>

            {soulPanel}
          </div>
        </section>
      )}

      <Dialog open={openFile !== null} onOpenChange={handleDialogOpenChange}>
        <DialogContent className="flex min-h-[min(82dvh,38rem)] max-h-[min(90dvh,85vh)] w-[calc(100%-1.5rem)] flex-col gap-4 p-4 sm:max-w-3xl sm:gap-6 sm:p-6">
          <DialogHeader className="gap-2 pr-8 sm:gap-3">
            <DialogTitle className="flex items-center gap-2 font-mono text-base">
              {openFileMeta?.writable ? (
                <FileTextIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              ) : (
                <FolderIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              )}
              {openFileMeta?.label}
            </DialogTitle>
            <DialogDescription className="leading-relaxed">
              {openFileMeta?.description}
              {!isWritable ? " Read-only in the UI." : null}
            </DialogDescription>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
            {dialogError ? (
              <p className="shrink-0 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {dialogError}
              </p>
            ) : null}

            {dialogLoading ? (
              <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
                <Spinner className="size-4" />
                Loading file content…
              </div>
            ) : (
              <>
                {openFile && status && !status.files[openFile] && !editContent ? (
                  <p className="shrink-0 text-sm leading-relaxed text-muted-foreground">
                    This file is missing. Start writing — it will be created when you save.
                  </p>
                ) : null}

                <Textarea
                  className="field-sizing-fixed min-h-[min(52dvh,22rem)] flex-1 resize-none overflow-y-auto font-mono text-xs leading-relaxed sm:min-h-[min(58dvh,26rem)]"
                  value={editContent}
                  readOnly={!isWritable || dialogLoading}
                  disabled={busy || dialogLoading}
                  placeholder={
                    isWritable
                      ? `Write ${openFileMeta?.label ?? "file"} content…`
                      : "Examples are loaded from markdown files under examples/."
                  }
                  onChange={(event) => setEditContent(event.target.value)}
                />

                {isWritable && isDirty ? (
                  <p className="shrink-0 text-xs font-medium text-amber-700 dark:text-amber-300">
                    Unsaved changes
                  </p>
                ) : null}
              </>
            )}
          </div>

          <DialogFooter className="mx-0 mb-0 shrink-0 flex-col-reverse gap-3 border-t border-border bg-transparent p-0 pt-4 sm:flex-row sm:justify-end sm:pt-5">
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => handleDialogOpenChange(false)}
            >
              Close
            </Button>
            {isWritable ? (
              <Button
                type="button"
                className="w-full sm:w-auto"
                disabled={busy || dialogLoading || !isDirty}
                onClick={() => void handleSave()}
              >
                {writeSoulMutation.isPending ? <Spinner className="size-4" /> : "Save file"}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ScopeButton({
  active,
  title,
  subtitle,
  activeLabel,
  leading,
  onClick,
}: {
  active: boolean;
  title: string;
  subtitle: string;
  activeLabel?: string;
  leading?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-active={active || undefined}
      className="scope-item"
    >
      <div className="flex items-start gap-3">
        {leading}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p
              className={cn(
                "truncate text-sm font-medium",
                active ? "text-primary" : "text-foreground",
              )}
            >
              {title}
            </p>
            {activeLabel ? (
              <span className="scope-badge scope-badge-active">{activeLabel}</span>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>
    </button>
  );
}

function FileStatusListItem({
  label,
  description,
  writable,
  present,
  onClick,
}: {
  label: string;
  description: string;
  writable: boolean;
  present: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "group flex min-h-11 w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition",
          "hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset",
          present && "bg-emerald-50/40 dark:bg-emerald-950/10",
        )}
      >
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-background",
            present ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground",
          )}
        >
          {writable ? (
            <FileTextIcon className="size-4" aria-hidden />
          ) : (
            <FolderIcon className="size-4" aria-hidden />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-sm text-foreground">{label}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{description}</p>
        </div>

        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
            present
              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
              : "bg-muted text-muted-foreground",
          )}
        >
          {present ? <CheckIcon className="size-3.5" /> : <CircleIcon className="size-3.5" />}
          {present ? "Present" : "Missing"}
        </span>

        <ChevronRightIcon
          className="size-4 shrink-0 text-muted-foreground/50 transition group-hover:text-muted-foreground"
          aria-hidden
        />
      </button>
    </li>
  );
}

function PageState({ message, embedded = false }: { message: string; embedded?: boolean }) {
  return (
    <div
      className={cn(
        embedded
          ? "flex min-h-48 flex-col items-center justify-center gap-3 text-sm text-muted-foreground"
          : cn(
              sectionClass,
              "flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-sm text-muted-foreground",
            ),
      )}
    >
      <Spinner className="size-5" />
      {message}
    </div>
  );
}
