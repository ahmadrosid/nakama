import type {
  LocalPluginPreviewResponse,
  PluginPackageRequest,
} from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nakama/ui/dialog";
import { Input } from "@nakama/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nakama/ui/select";
import { Spinner } from "@nakama/ui/spinner";
import { cn } from "@nakama/ui/utils";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown01Icon, ArrowRight01Icon } from "hugeicons-react";
import { useRef, useState } from "react";
import { useInstallLocalPlugin } from "@/hooks/use-plugins";
import { client, formatError } from "@/lib/client";
import { formatBytes } from "@/lib/knowledge-base-files";

export function PluginPackageForm({
  busy,
  onClose,
  onPreview,
}: {
  busy: boolean;
  onClose(): void;
  onPreview(source: PluginPackageRequest): void;
}) {
  const [packageName, setPackageName] = useState("");
  const [packageVersion, setPackageVersion] = useState("");

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        onPreview({
          packageName: packageName.trim(),
          version: packageVersion.trim(),
        });
      }}
    >
      <label className="grid gap-2 text-sm">
        npm package
        <Input
          aria-label="npm package name"
          disabled={busy}
          onChange={(event) => setPackageName(event.target.value)}
          placeholder="@team/nakama-notes"
          required
          value={packageName}
        />
      </label>
      <label className="grid gap-2 text-sm">
        Version
        <Input
          aria-label="Exact package version"
          disabled={busy}
          onChange={(event) => setPackageVersion(event.target.value)}
          placeholder="1.0.0"
          required
          value={packageVersion}
        />
      </label>
      <DialogFooter>
        <Button
          disabled={busy}
          onClick={onClose}
          type="button"
          variant="outline"
        >
          Cancel
        </Button>
        <Button
          disabled={busy || !packageName.trim() || !packageVersion.trim()}
          size="sm"
          type="submit"
        >
          {busy ? <Spinner className="size-4" /> : null}
          Preview package
        </Button>
      </DialogFooter>
    </form>
  );
}

// Code that runs first, so the reviewer reads it first. The last group catches the rest.
const LOCAL_REVIEW_GROUPS = [
  ["Runs on the server", /^(actions|workers)\//],
  ["Runs in the browser", /^ui\//],
  ["Database migrations", /^migrations\//],
  ["Source", /^src\//],
  ["Config and other files", /./],
] as const;

/** Display only: the install still uses the reviewed bytes and digest. */
function formatJsonForReview(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function LocalPluginReviewFiles({
  disabled,
  file,
  files,
  onClose,
  onRead,
  reviewed,
}: {
  disabled: boolean;
  file: { path: string; content: string } | null;
  files: LocalPluginPreviewResponse["files"];
  onClose(): void;
  onRead(path: string): Promise<void>;
  reviewed: Set<string>;
}) {
  return (
    <>
      {LOCAL_REVIEW_GROUPS.map(([label, pattern], index) => {
        const groupFiles = files.filter(
          (item) =>
            LOCAL_REVIEW_GROUPS.findIndex(([, match]) =>
              match.test(item.path)
            ) === index
        );

        if (groupFiles.length === 0) {
          return null;
        }

        const runs = index < 3;

        return (
          <section className="min-w-0" key={String(pattern)}>
            <h3
              className={cn(
                "mb-1.5 font-semibold text-xs uppercase tracking-wide",
                runs ? "text-primary" : "text-muted-foreground"
              )}
            >
              {label}
            </h3>
            <ul
              className={cn(
                "divide-y overflow-hidden rounded-lg border",
                runs && "border-primary/40"
              )}
            >
              {groupFiles.map((item) => {
                const open = file?.path === item.path;
                const read = reviewed.has(item.path);

                return (
                  <li key={item.path}>
                    <button
                      aria-expanded={open}
                      className={cn(
                        "flex min-h-11 w-full items-center gap-2.5 px-3 text-left text-sm disabled:opacity-60",
                        open && "bg-muted/60"
                      )}
                      disabled={disabled}
                      onClick={() => (open ? onClose() : onRead(item.path))}
                      type="button"
                    >
                      {open ? (
                        <ArrowDown01Icon aria-hidden className="size-4" />
                      ) : (
                        <ArrowRight01Icon aria-hidden className="size-4" />
                      )}
                      <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
                        {item.path}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {formatBytes(item.size)}
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 font-medium text-xs",
                          read
                            ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"
                            : "border text-muted-foreground"
                        )}
                      >
                        {read ? "Read" : "Not read"}
                      </span>
                    </button>
                    {open ? (
                      <pre
                        aria-label={file.path}
                        className="max-h-72 overflow-auto whitespace-pre-wrap break-all border-t bg-background p-3 font-mono text-xs leading-relaxed"
                      >
                        {file.content}
                      </pre>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </>
  );
}

function LocalPluginDraftPicker({
  disabled,
  draftId,
  error,
  open,
  orgId,
  profileId,
  onDraftChange,
  onProfileChange,
  onPreview,
}: {
  disabled: boolean;
  draftId: string;
  error: string | null;
  open: boolean;
  orgId: string;
  profileId: string;
  onDraftChange(value: string): void;
  onProfileChange(value: string): void;
  onPreview(): Promise<void>;
}) {
  const profiles = useQuery({
    enabled: open,
    queryFn: () => client.listProfiles(orgId),
    queryKey: ["plugin-draft-profiles", orgId],
  });

  return (
    <>
      <Select
        disabled={disabled}
        onValueChange={(value) => {
          onProfileChange(value ?? "");
        }}
        value={profileId}
      >
        <SelectTrigger aria-label="Agent">
          <SelectValue placeholder="Agent" />
        </SelectTrigger>
        <SelectContent>
          {(profiles.data?.profiles ?? []).map((profile) => (
            <SelectItem key={profile.id} value={profile.id}>
              {profile.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        aria-label="Draft ID"
        disabled={disabled}
        onChange={(event) => {
          onDraftChange(event.target.value);
        }}
        placeholder="Draft ID"
        value={draftId}
      />
      {profiles.error ? (
        <p role="alert">{formatError(profiles.error)}</p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      <Button
        disabled={!(profileId && draftId) || disabled}
        onClick={onPreview}
      >
        Preview draft
      </Button>
    </>
  );
}

/** Reads a draft file in chunks. Returns null when a newer request took over. */
async function readLocalPluginText(
  preview: LocalPluginPreviewResponse,
  path: string,
  isCurrent: () => boolean
): Promise<string | null> {
  const chunks: Uint8Array[] = [];
  let offset: number | null = 0;

  while (offset !== null && isCurrent()) {
    const value = await client.readLocalPluginFile({
      ...preview.draft,
      expectedDigest: preview.digest,
      offset,
      path,
    });

    chunks.push(
      Uint8Array.from(atob(value.content), (character) =>
        character.charCodeAt(0)
      )
    );
    offset = value.nextOffset;
  }

  if (!isCurrent()) {
    return null;
  }

  const data = new Uint8Array(
    chunks.reduce((size, chunk) => size + chunk.length, 0)
  );

  let position = 0;

  for (const chunk of chunks) {
    data.set(chunk, position);
    position += chunk.length;
  }

  const text = new TextDecoder().decode(data);

  return path.endsWith(".json") ? formatJsonForReview(text) : text;
}

function LocalPluginInstallButton({
  draft,
  onClick,
}: {
  draft: boolean;
  onClick(): void;
}) {
  return (
    <Button
      onClick={onClick}
      size={draft ? "sm" : "default"}
      variant={draft ? "default" : "outline"}
    >
      {draft ? "Review and install" : "Install from folder"}
    </Button>
  );
}

export function LocalPluginInstaller({
  draft,
  orgId,
  open: openProp,
  onOpenChange,
}: {
  draft?: { draftId: string; profileId: string };
  orgId: string;
  /** Set both to open the dialog from another control; no trigger button renders. */
  open?: boolean;
  onOpenChange?(open: boolean): void;
}) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = openProp ?? localOpen;
  const setOpen = onOpenChange ?? setLocalOpen;
  const [profileId, setProfileId] = useState(draft?.profileId ?? "");
  const [draftId, setDraftId] = useState(draft?.draftId ?? "");

  const [preview, setPreview] = useState<LocalPluginPreviewResponse | null>(
    null
  );

  const [file, setFile] = useState<{ path: string; content: string } | null>(
    null
  );

  const [reviewed, setReviewed] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const install = useInstallLocalPlugin();
  const busy = pending || install.isPending;

  function reset() {
    generation.current += 1;
    setPreview(null);
    setFile(null);
    setReviewed(new Set());
    setPending(false);
    setError(null);
  }

  async function loadPreview() {
    reset();
    const turn = generation.current;
    setPending(true);

    try {
      const value = await client.previewLocalPlugin({
        draftId,
        orgId,
        profileId,
      });

      if (turn === generation.current) {
        setPreview(value);
      }
    } catch (failure) {
      if (turn === generation.current) {
        setError(formatError(failure));
      }
    } finally {
      setPending((previous) =>
        turn === generation.current ? false : previous
      );
    }
  }

  async function readFile(path: string) {
    if (!preview) {
      return;
    }

    const turn = ++generation.current;
    setFile(null);
    setPending(true);
    setError(null);

    try {
      const content = await readLocalPluginText(
        preview,
        path,
        () => turn === generation.current
      );

      if (content !== null) {
        setFile({ content, path });
        setReviewed((previous) => new Set([...previous, path]));
      }
    } catch (failure) {
      if (turn === generation.current) {
        setError(formatError(failure));
        setPreview(null);
        setReviewed(new Set());
      }
    } finally {
      setPending((previous) =>
        turn === generation.current ? false : previous
      );
    }
  }

  async function confirm() {
    if (!preview || pending || install.isPending) {
      return;
    }

    setError(null);

    try {
      await install.mutateAsync({
        ...preview.draft,
        expectedDigest: preview.digest,
        expectedRevision: preview.expectedRevision,
      });
      setOpen(false);
      reset();
    } catch (failure) {
      setError(formatError(failure));
      setPreview(null);
      setReviewed(new Set());
    }
  }

  return (
    <Dialog
      onOpenChange={(next) => {
        setOpen(next);
        reset();
      }}
      open={open}
    >
      {onOpenChange ? null : (
        <LocalPluginInstallButton
          draft={Boolean(draft)}
          onClick={() => {
            reset();
            setOpen(true);

            if (draft) {
              void loadPreview();
            }
          }}
        />
      )}
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Install a plugin made by an agent</DialogTitle>
        </DialogHeader>
        {draft ? (
          error ? (
            <p role="alert">{error}</p>
          ) : null
        ) : (
          <LocalPluginDraftPicker
            disabled={busy}
            draftId={draftId}
            error={error}
            onDraftChange={(value) => {
              reset();
              setDraftId(value);
            }}
            onPreview={loadPreview}
            onProfileChange={(value) => {
              reset();
              setProfileId(value);
            }}
            open={open}
            orgId={orgId}
            profileId={profileId}
          />
        )}
        {preview ? (
          <>
            <div>
              <p className="font-medium">
                {preview.manifest.name}{" "}
                <span className="font-normal text-muted-foreground">
                  {preview.manifest.version}
                </span>
              </p>
              <p className="text-muted-foreground text-sm">
                Install only plugins you trust. A plugin can see and change all
                data on this server.
              </p>
            </div>
            <LocalPluginReviewFiles
              disabled={busy}
              file={file}
              files={preview.files}
              onClose={() => setFile(null)}
              onRead={readFile}
              reviewed={reviewed}
            />
            <DialogFooter className="sticky -bottom-4 z-10 items-center gap-3 bg-muted sm:justify-between">
              <span className="min-w-0 truncate font-mono text-muted-foreground text-xs">
                sha256 {preview.digest}
              </span>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-muted-foreground text-sm tabular-nums">
                  {reviewed.size} of {preview.files.length} read
                </span>
                <Button disabled={busy} onClick={confirm}>
                  {install.isPending ? "Installing…" : "Confirm installation"}
                </Button>
              </div>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
