import type { SoulStackFiles } from "@tinyclaw/core/contract";
import { CheckIcon, CircleIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useState } from "react";
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

const sectionClass = "rounded-md border border-border bg-card p-4";

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
  const {
    data: profiles = [],
    error: profilesError,
    isFetching: profilesFetching,
    refetch: refetchProfiles,
  } = useProfilesQuery();
  const [scope, setScope] = useState<SoulScope>("global");
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

  function handleScopeChange(nextScope: SoulScope) {
    setScope(nextScope);
    setOpenFile(null);
    setInitResult(null);
  }

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

  if (loading && !status) {
    return <PageState message="Loading soul stack…" />;
  }

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <section className={sectionClass}>
          <div className="mb-4">
            <h2 className="type-section-title">Scope</h2>
            <p className="type-body mt-1 text-xs">
              Global files apply to every profile. Profile overrides merge on top.
            </p>
          </div>

          <div className="space-y-2">
            <ScopeButton
              active={scope === "global"}
              title="Global soul"
              subtitle="~/.tinyclaw/"
              activeLabel={status?.active && scope === "global" ? "active" : undefined}
              onClick={() => void handleScopeChange("global")}
            />

            {profiles.map((profile) => (
              <ScopeButton
                key={profile.id}
                active={scope === profile.id}
                title={profile.name}
                subtitle={profile.soulActive ? "soul active" : "soul inactive"}
                activeLabel={profile.soulActive ? "active" : undefined}
                leading={<ProfileAvatar profile={profile} size="sm" />}
                onClick={() => handleScopeChange(profile.id)}
              />
            ))}
          </div>

          <div className="type-body mt-5 rounded-md border border-border bg-muted/40 p-3 text-xs dark:bg-muted/30">
            <p className="font-medium text-foreground">How it works</p>
            <p className="mt-2">
              Soul files shape the agent&apos;s identity and voice. Click a file to view its
              content. Start a new chat session after editing so changes take effect.
            </p>
          </div>
        </section>

        <section className="space-y-4">
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

          <div className={cn(sectionClass, "p-5")}>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="type-page-title">{scopeLabel}</h2>
                {status ? (
                  <p className="type-code mt-1 break-all text-muted-foreground">
                    {status.directory}
                  </p>
                ) : null}
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy || refreshing}
                  onClick={() => void refresh()}
                >
                  <RefreshCwIcon />
                  Refresh
                </Button>
                <Button type="button" size="sm" disabled={busy} onClick={() => void handleInit()}>
                  Init templates
                </Button>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {SOUL_FILES.map((file) => (
                <FileStatusCard
                  key={file.key}
                  label={file.label}
                  present={status?.files[file.key] ?? false}
                  onClick={() => handleOpenFile(file.key)}
                />
              ))}
            </div>
          </div>
        </section>
      </div>

      <Dialog open={openFile !== null} onOpenChange={handleDialogOpenChange}>
        <DialogContent className="flex max-h-[85vh] flex-col gap-6 p-6 sm:max-w-3xl">
          <DialogHeader className="gap-3 pr-8">
            <DialogTitle className="font-mono text-base">{openFileMeta?.label}</DialogTitle>
            <DialogDescription className="leading-relaxed">
              {openFileMeta?.description}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
            {dialogError ? (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {dialogError}
              </p>
            ) : null}

            {dialogLoading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Loading file content…</p>
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
                  className="min-h-80 font-mono text-xs leading-relaxed"
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
                  <p className="text-xs text-amber-300/90">Unsaved changes</p>
                ) : null}
              </>
            )}
          </div>

          <DialogFooter className="gap-3 border-t-0 bg-transparent p-0 pt-2 sm:justify-end">
            <Button type="button" variant="outline" onClick={() => handleDialogOpenChange(false)}>
              Close
            </Button>
            {isWritable ? (
              <Button
                type="button"
                disabled={busy || dialogLoading || !isDirty}
                onClick={() => void handleSave()}
              >
                Save file
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
                "text-sm font-medium",
                active ? "text-primary" : "text-foreground",
              )}
            >
              {title}
            </p>
            {activeLabel ? (
              <span className="scope-badge scope-badge-active">{activeLabel}</span>
            ) : null}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>
    </button>
  );
}

function FileStatusCard({
  label,
  present,
  onClick,
}: {
  label: string;
  present: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex cursor-pointer items-center justify-between rounded-md border border-border bg-muted/20 px-4 py-3 text-left transition hover:bg-muted/50"
    >
      <span className="font-mono text-sm text-foreground">{label}</span>
      <span
        className={cn(
          "flex items-center gap-1 text-xs font-medium",
          present
            ? "text-emerald-700 dark:text-emerald-300"
            : "text-muted-foreground",
        )}
      >
        {present ? <CheckIcon className="size-3.5" /> : <CircleIcon className="size-3.5" />}
        {present ? "present" : "missing"}
      </span>
    </button>
  );
}

function PageState({ message }: { message: string }) {
  return (
    <div
      className={cn(
        sectionClass,
        "flex min-h-64 items-center justify-center p-8 text-sm text-muted-foreground",
      )}
    >
      {message}
    </div>
  );
}
