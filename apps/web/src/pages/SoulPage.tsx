import type { SoulStackFiles } from "@tinyclaw/core/contract";
import {
  CheckIcon,
  ChevronRightIcon,
  CircleIcon,
  FileTextIcon,
  FolderIcon,
  RefreshCwIcon,
  SparklesIcon,
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
  useInitProfileSoulMutation,
  useInitSoulMutation,
  useSoulFileQuery,
  useSoulStatusQuery,
  useWriteSoulFileMutation,
} from "@/hooks/use-resource-mutations";
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
    key: "skill" as const,
    label: "SKILL.md",
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

type SoulScope = "global" | string;

export function SoulPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    data: profiles = [],
    error: profilesError,
    isFetching: profilesFetching,
    refetch: refetchProfiles,
  } = useProfilesQuery();
  const [scope, setScopeState] = useState<SoulScope>("global");
  const scopeInitializedRef = useRef(false);
  const {
    data: status = null,
    isLoading: statusLoading,
    isFetching: statusFetching,
    error: statusError,
    refetch: refetchStatus,
  } = useSoulStatusQuery(scope);
  const [openFile, setOpenFile] = useState<keyof SoulStackFiles | null>(null);
  const {
    data: fileContent = "",
    isLoading: dialogLoading,
    error: fileError,
  } = useSoulFileQuery(scope, openFile, openFile !== null);
  const initSoulMutation = useInitSoulMutation();
  const initProfileSoulMutation = useInitProfileSoulMutation();
  const writeSoulMutation = useWriteSoulFileMutation();
  const [editContent, setEditContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [initResult, setInitResult] = useState<string[] | null>(null);

  const busy =
    initSoulMutation.isPending ||
    initProfileSoulMutation.isPending ||
    writeSoulMutation.isPending;
  const loading = statusLoading && !status;
  const refreshing = profilesFetching || statusFetching;

  const openFileMeta = openFile ? SOUL_FILES.find((file) => file.key === openFile) : null;
  const isDirty = editContent !== savedContent;
  const isWritable = openFileMeta?.writable ?? false;

  const presentCount = useMemo(() => {
    if (!status) {
      return 0;
    }

    return SOUL_FILES.filter((file) => status.files[file.key]).length;
  }, [status]);

  const setScope = useCallback(
    (nextScope: SoulScope) => {
      setScopeState(nextScope);
      setOpenFile(null);
      setInitResult(null);
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (nextScope === "global") {
            next.delete("scope");
          } else {
            next.set("scope", nextScope);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  useEffect(() => {
    if (scopeInitializedRef.current) {
      if (scope !== "global" && !profiles.some((profile) => profile.id === scope)) {
        setScope("global");
      }
      return;
    }

    scopeInitializedRef.current = true;
    const fromUrl = searchParams.get("scope");
    if (fromUrl === "global" || fromUrl === null) {
      setScopeState("global");
      return;
    }

    const matchedProfile = profiles.find((profile) => profile.id === fromUrl);
    if (matchedProfile) {
      setScopeState(matchedProfile.id);
    }
  }, [profiles, scope, searchParams, setScope]);

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

  async function handleInit() {
    setError(null);
    setInitResult(null);

    try {
      const result =
        scope === "global"
          ? await initSoulMutation.mutateAsync()
          : await initProfileSoulMutation.mutateAsync(scope);
      setInitResult(result.created);
    } catch (err) {
      setError(formatError(err));
    }
  }

  async function handleSave() {
    if (!openFile || !isWritable || !isDirty) {
      return;
    }

    setDialogError(null);

    try {
      await writeSoulMutation.mutateAsync({
        scope,
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

  const scopeLabel =
    scope === "global"
      ? "Global soul"
      : (profiles.find((profile) => profile.id === scope)?.name ?? "Profile soul");

  const scopeSubtitle =
    scope === "global" ? "~/.tinyclaw/" : "Profile override · merges on top of global";

  const stackActive =
    scope === "global"
      ? (status?.active ?? false)
      : (profiles.find((profile) => profile.id === scope)?.soulActive ?? false);

  if (loading && !status) {
    return <PageState message="Loading soul stack…" />;
  }

  return (
    <>
      <div className="space-y-4">
        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {initResult ? (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-800/40 dark:bg-emerald-950/20 dark:text-emerald-200">
            {initResult.length === 0
              ? "Templates already exist — nothing created."
              : `Created: ${initResult.join(", ")}`}
          </p>
        ) : null}

        <section className={cn(sectionClass, "overflow-hidden")}>
          <div className="flex flex-wrap items-center gap-3 border-b border-border p-4 lg:hidden">
            <Select
              value={scope}
              disabled={busy || refreshing}
              onValueChange={(value) => setScope(value != null ? String(value) : "global")}
            >
              <SelectTrigger className="min-w-0 flex-1" aria-label="Soul scope">
                <SelectValue placeholder="Select scope" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="global">
                  <span className="flex items-center gap-2">
                    <SparklesIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span>Global soul</span>
                  </span>
                </SelectItem>
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
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() => void handleInit()}
              >
                Init
              </Button>
            </div>
          </div>

          <div className="grid gap-0 lg:grid-cols-[240px_minmax(0,1fr)]">
            <aside className="hidden border-b border-border p-4 lg:block lg:border-r lg:border-b-0">
              <div className="mb-4">
                <h2 className="type-section-title">Scope</h2>
                <p className="type-body mt-1 text-xs">
                  Global files apply to every profile. Profile overrides merge on top.
                </p>
              </div>

              <div className="max-h-[min(40vh,320px)] space-y-2 overflow-y-auto pr-1 lg:max-h-none">
                <ScopeButton
                  active={scope === "global"}
                  title="Global soul"
                  subtitle="~/.tinyclaw/"
                  activeLabel={status?.active && scope === "global" ? "active" : undefined}
                  leading={
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/60">
                      <SparklesIcon className="size-4 text-muted-foreground" aria-hidden />
                    </span>
                  }
                  onClick={() => setScope("global")}
                />

                {profiles.map((profile) => (
                  <ScopeButton
                    key={profile.id}
                    active={scope === profile.id}
                    title={profile.name}
                    subtitle={profile.soulActive ? "soul active" : "soul inactive"}
                    activeLabel={profile.soulActive ? "active" : undefined}
                    leading={<ProfileAvatar profile={profile} size="sm" />}
                    onClick={() => setScope(profile.id)}
                  />
                ))}
              </div>

              <div className="type-body mt-5 rounded-md border border-border bg-muted/40 p-3 text-xs dark:bg-muted/30">
                <p className="font-medium text-foreground">How it works</p>
                <p className="mt-2">
                  Soul files shape the agent&apos;s identity and voice. Click a file to view or edit
                  its content. Start a new chat session after editing so changes take effect.
                </p>
              </div>
            </aside>

            <div className="min-w-0 p-4 sm:p-5">
              <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="type-section-title">{scopeLabel}</h2>
                    {stackActive ? (
                      <span className="scope-badge scope-badge-active">active</span>
                    ) : null}
                  </div>
                  <p className="type-body mt-1 text-xs">{scopeSubtitle}</p>
                  {status ? (
                    <p
                      className="type-code mt-2 truncate text-muted-foreground"
                      title={status.directory}
                    >
                      {status.directory}
                    </p>
                  ) : null}
                </div>

                <div className="hidden shrink-0 items-center gap-2 lg:flex">
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
                  <Button type="button" size="sm" disabled={busy} onClick={() => void handleInit()}>
                    Init templates
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

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {SOUL_FILES.map((file) => (
                  <FileStatusCard
                    key={file.key}
                    label={file.label}
                    description={file.description}
                    writable={file.writable}
                    present={status?.files[file.key] ?? false}
                    onClick={() => handleOpenFile(file.key)}
                  />
                ))}
              </div>

              <div className="type-body mt-5 rounded-md border border-border bg-muted/40 p-3 text-xs lg:hidden dark:bg-muted/30">
                <p className="font-medium text-foreground">How it works</p>
                <p className="mt-2">
                  Soul files shape the agent&apos;s identity and voice. Start a new chat session
                  after editing so changes take effect.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>

      <Dialog open={openFile !== null} onOpenChange={handleDialogOpenChange}>
        <DialogContent className="flex max-h-[min(90dvh,85vh)] w-[calc(100%-1.5rem)] flex-col gap-4 p-4 sm:max-w-3xl sm:gap-6 sm:p-6">
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

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
            {dialogError ? (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {dialogError}
              </p>
            ) : null}

            {dialogLoading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <Spinner className="size-4" />
                Loading file content…
              </div>
            ) : (
              <>
                {openFile && status && !status.files[openFile] && !editContent ? (
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    This file is missing. Run{" "}
                    <strong className="text-foreground">Init templates</strong> or start writing to
                    create it on save.
                  </p>
                ) : null}

                <Textarea
                  className="min-h-48 font-mono text-xs leading-relaxed sm:min-h-80"
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
                  <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
                    Unsaved changes
                  </p>
                ) : null}
              </>
            )}
          </div>

          <DialogFooter className="flex-col-reverse gap-2 border-t-0 bg-transparent p-0 pt-2 sm:flex-row sm:justify-end sm:gap-3">
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

function FileStatusCard({
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
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex min-h-11 w-full cursor-pointer flex-col gap-3 rounded-md border border-border bg-muted/20 p-4 text-left transition",
        "hover:border-primary/20 hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        present && "border-emerald-200/60 dark:border-emerald-900/40",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-background",
              present
                ? "text-emerald-700 dark:text-emerald-300"
                : "text-muted-foreground",
            )}
          >
            {writable ? (
              <FileTextIcon className="size-4" aria-hidden />
            ) : (
              <FolderIcon className="size-4" aria-hidden />
            )}
          </span>
          <div className="min-w-0">
            <p className="truncate font-mono text-sm text-foreground">{label}</p>
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {description}
            </p>
          </div>
        </div>
        <ChevronRightIcon
          className="size-4 shrink-0 text-muted-foreground/50 transition group-hover:text-muted-foreground"
          aria-hidden
        />
      </div>

      <span
        className={cn(
          "inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
          present
            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
            : "bg-muted text-muted-foreground",
        )}
      >
        {present ? <CheckIcon className="size-3.5" /> : <CircleIcon className="size-3.5" />}
        {present ? "Present" : "Missing"}
      </span>
    </button>
  );
}

function PageState({ message }: { message: string }) {
  return (
    <div
      className={cn(
        sectionClass,
        "flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-sm text-muted-foreground",
      )}
    >
      <Spinner className="size-5" />
      {message}
    </div>
  );
}
