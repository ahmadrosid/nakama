import type {
  ProfileSummary,
  SoulStackFiles,
  SoulStatusResponse,
} from "@tinyclaw/core/contract";
import { CheckIcon, CircleIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
import { cn } from "@/lib/utils";
import { client, formatError } from "@/lib/client";

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
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [scope, setScope] = useState<SoulScope>("global");
  const [status, setStatus] = useState<SoulStatusResponse | null>(null);
  const [openFile, setOpenFile] = useState<keyof SoulStackFiles | null>(null);
  const [editContent, setEditContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [dialogLoading, setDialogLoading] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initResult, setInitResult] = useState<string[] | null>(null);

  const openFileMeta = openFile ? SOUL_FILES.find((file) => file.key === openFile) : null;
  const isDirty = editContent !== savedContent;
  const isWritable = openFileMeta?.writable ?? false;

  const loadProfiles = useCallback(async () => {
    try {
      const response = await client.listProfiles();
      setProfiles(response.profiles);
    } catch (err) {
      setError(formatError(err));
    }
  }, []);

  const loadScope = useCallback(async (nextScope: SoulScope) => {
    setError(null);
    setInitResult(null);

    try {
      const nextStatus =
        nextScope === "global"
          ? await client.getSoulStatus()
          : await client.getProfileSoulStatus(nextScope);

      setStatus(nextStatus);
    } catch (err) {
      setError(formatError(err));
      setStatus(null);
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      await loadProfiles();
      await loadScope(scope);
    } finally {
      setLoading(false);
    }
  }, [loadProfiles, loadScope, scope]);

  useEffect(() => {
    void (async () => {
      setLoading(true);

      try {
        await loadProfiles();
        await loadScope("global");
      } finally {
        setLoading(false);
      }
    })();
  }, [loadProfiles, loadScope]);

  async function handleScopeChange(nextScope: SoulScope) {
    setScope(nextScope);
    setOpenFile(null);
    setLoading(true);

    try {
      await loadScope(nextScope);
    } finally {
      setLoading(false);
    }
  }

  function handleOpenFile(fileKey: keyof SoulStackFiles) {
    setOpenFile(fileKey);
    setEditContent("");
    setSavedContent("");
    setDialogError(null);
    void loadFileContent(fileKey);
  }

  async function loadFileContent(fileKey: keyof SoulStackFiles) {
    setDialogLoading(true);
    setDialogError(null);

    try {
      const response =
        scope === "global"
          ? await client.getSoulStatus({ includeContents: true })
          : await client.getProfileSoulStatus(scope, { includeContents: true });

      const content = response.contents?.[fileKey] ?? "";
      setEditContent(content);
      setSavedContent(content);
    } catch (err) {
      setDialogError(formatError(err));
    } finally {
      setDialogLoading(false);
    }
  }

  function handleDialogOpenChange(open: boolean) {
    if (!open) {
      setOpenFile(null);
      setDialogError(null);
    }
  }

  async function handleInit() {
    setBusy(true);
    setError(null);
    setInitResult(null);

    try {
      const result =
        scope === "global"
          ? await client.initSoul()
          : await client.initProfileSoul(scope);
      setInitResult(result.created);
      await loadScope(scope);
      await loadProfiles();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    if (!openFile || !isWritable || !isDirty) {
      return;
    }

    setBusy(true);
    setDialogError(null);

    try {
      if (scope === "global") {
        await client.writeSoulFile(openFile, editContent);
      } else {
        await client.writeProfileSoulFile(scope, openFile, editContent);
      }

      setSavedContent(editContent);
      await loadScope(scope);
      await loadProfiles();
    } catch (err) {
      setDialogError(formatError(err));
    } finally {
      setBusy(false);
    }
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
      <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <section className={sectionClass}>
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-foreground">Scope</h2>
            <p className="mt-1 text-xs text-muted-foreground">
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
                onClick={() => void handleScopeChange(profile.id)}
              />
            ))}
          </div>

          <div className="mt-5 rounded-md border border-border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
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
            <p className="rounded-md border border-emerald-800/40 bg-emerald-950/20 px-4 py-3 text-sm text-emerald-200">
              {initResult.length === 0
                ? "Templates already exist — nothing created."
                : `Created: ${initResult.join(", ")}`}
            </p>
          ) : null}

          <div className={cn(sectionClass, "p-5")}>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-foreground">{scopeLabel}</h2>
                {status ? (
                  <p className="mt-1 font-mono text-xs text-muted-foreground break-all">
                    {status.directory}
                  </p>
                ) : null}
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy || loading}
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
  onClick,
}: {
  active: boolean;
  title: string;
  subtitle: string;
  activeLabel?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-md border px-3 py-3 text-left transition",
        active
          ? "border-primary/40 bg-muted"
          : "border-border bg-transparent hover:bg-muted/50",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {activeLabel ? (
          <span className="rounded-md bg-emerald-950/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
            {activeLabel}
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
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
      className="flex items-center justify-between rounded-md border border-border bg-muted/20 px-4 py-3 text-left transition hover:bg-muted/40"
    >
      <span className="font-mono text-sm text-foreground">{label}</span>
      <span
        className={cn(
          "flex items-center gap-1 text-xs font-medium",
          present ? "text-emerald-300" : "text-muted-foreground",
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
