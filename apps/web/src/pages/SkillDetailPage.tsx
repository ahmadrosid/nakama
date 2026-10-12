import { Button } from "@nakama/ui/button";
import { CodeBlock } from "@nakama/ui/code-block";
import { Spinner } from "@nakama/ui/spinner";
import { toast } from "@nakama/ui/toast";
import { cn } from "@nakama/ui/utils";
import {
  ArrowLeft02Icon,
  ArrowRight01Icon,
  Delete02Icon,
  File02Icon,
  Folder01Icon,
  FolderOpenIcon,
} from "hugeicons-react";
import { type ReactNode, useState } from "react";
import {
  Link,
  Navigate,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { RemoveSkillFromProfileDialog } from "@/components/RemoveSkillFromProfileDialog";
import { SkillDetailContent } from "@/components/SkillDetailContent";
import { useAuth } from "@/context/use-auth";
import { useProfileQuery, useSkillQuery } from "@/hooks/use-app-queries";
import {
  usePatchSkillMutation,
  useUnassignSkillMutation,
} from "@/hooks/use-resource-mutations";
import { client, formatError } from "@/lib/client";
import { canAccessSystemPage, skillDetailBackTarget } from "@/lib/navigation";
import { invalidateQueries } from "@/lib/query-client";
import { queryKeys } from "@/lib/query-keys";

const sectionClass = "rounded-md border border-border bg-card";

export function SkillDetailPage() {
  const { skillId } = useParams<{ skillId: string }>();
  const [searchParams] = useSearchParams();
  const { user, activeOrg, isLoading: authLoading } = useAuth();
  const isPlatformAdmin = user?.isPlatformAdmin === true;
  const canAccess = canAccessSystemPage(isPlatformAdmin, activeOrg?.role);
  const back = skillDetailBackTarget(searchParams);
  const profileId = searchParams.get("profile");

  const {
    data: skill,
    isLoading: skillLoading,
    error: skillError,
  } = useSkillQuery(skillId ?? null);

  const { data: profile } = useProfileQuery(profileId);

  if (authLoading) {
    return <PageState message="Loading…" />;
  }

  if (!canAccess) {
    return <Navigate replace to="/chat" />;
  }

  if (!skillId) {
    return <Navigate replace to={back.href} />;
  }

  if (skillLoading && !skill) {
    return <PageState message="Loading skill…" />;
  }

  if (skillError && !skill) {
    return (
      <div className="space-y-4 px-6 py-4">
        <BackLink />
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive text-sm">
          {formatError(skillError)}
        </p>
      </div>
    );
  }

  if (!skill) {
    return <Navigate replace to={back.href} />;
  }

  const profileSkill = profile?.skills.find((entry) => entry.id === skill.id);
  const canRemoveFromProfile = Boolean(profileId && profileSkill);

  return (
    <SkillDetailPageContent
      back={back}
      canRemoveFromProfile={canRemoveFromProfile}
      createdBy={profileSkill?.createdBy}
      key={`${activeOrg?.id}:${skill.id}`}
      profileId={profileId}
      skill={skill}
      usageSummary={profileSkill?.usage}
    />
  );
}

function SkillDetailPageContent({
  skill,
  usageSummary,
  createdBy,
  back,
  profileId,
  canRemoveFromProfile,
}: {
  skill: NonNullable<ReturnType<typeof useSkillQuery>["data"]>;
  usageSummary?: NonNullable<
    ReturnType<typeof useProfileQuery>["data"]
  >["skills"][number]["usage"];
  createdBy?: NonNullable<
    ReturnType<typeof useProfileQuery>["data"]
  >["skills"][number]["createdBy"];
  back: { href: string; label: string };
  profileId: string | null;
  canRemoveFromProfile: boolean;
}) {
  const navigate = useNavigate();
  const unassignSkillMutation = useUnassignSkillMutation();
  const patchSkillMutation = usePatchSkillMutation();
  const [removeOpen, setRemoveOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(skill.body);
  const [editNote, setEditNote] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const { activeOrg } = useAuth();
  const orgId = activeOrg?.id ?? "";
  const [selectedFile, setSelectedFile] = useState("SKILL.md");

  const filesQuery = useQuery({
    enabled: Boolean(orgId),
    queryFn: () => client.listSkillFiles(skill.id, orgId),
    queryKey: [...queryKeys.skills.detail(skill.id), "files", orgId],
  });

  const busy = unassignSkillMutation.isPending || patchSkillMutation.isPending;

  function handleRemoveOpenChange(open: boolean) {
    if (!open && busy) {
      return;
    }

    setRemoveOpen(open);
  }

  async function handleRemoveConfirm() {
    if (!profileId) {
      return;
    }

    await unassignSkillMutation.mutateAsync({ profileId, skillId: skill.id });
    setRemoveOpen(false);
    navigate(back.href);
  }

  function handleStartEdit() {
    setEditBody(skill.body);
    setEditNote("");
    setSaveError(null);
    setEditing(true);
  }

  function handleCancelEdit() {
    if (busy) {
      return;
    }

    setEditing(false);
    setEditBody(skill.body);
    setSaveError(null);
  }

  async function handleSaveEdit() {
    if (busy) {
      return;
    }

    setSaveError(null);

    try {
      await patchSkillMutation.mutateAsync({
        input: { body: editBody, note: editNote.trim() || undefined },
        profileId: profileId ?? undefined,
        skillId: skill.id,
      });
      setEditing(false);
    } catch (error) {
      const message = formatError(error);
      toast(message);
      setSaveError(message);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-border border-b px-4 py-3">
        <BackLink />
        {canRemoveFromProfile ? (
          <Button
            aria-haspopup="dialog"
            disabled={busy}
            onClick={() => setRemoveOpen(true)}
            size="sm"
            type="button"
            variant="destructive"
          >
            <Delete02Icon aria-hidden className="size-4" />
            Remove from profile
          </Button>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className="max-h-60 shrink-0 overflow-auto border-border border-b p-2 md:max-h-none md:w-60 md:border-r md:border-b-0">
          <h1 className="break-words px-2 py-3 font-semibold text-sm">
            {skill.name}
          </h1>
          <nav aria-label="Skill files">
            {filesQuery.isLoading && (
              <p className="p-2 text-muted-foreground text-sm" role="status">
                Loading files…
              </p>
            )}
            {filesQuery.error && (
              <Button onClick={() => void filesQuery.refetch()} variant="ghost">
                Couldn’t load files. Retry
              </Button>
            )}
            <SkillFileTree
              disabled={editing || busy}
              files={
                filesQuery.data?.files ?? [{ path: "SKILL.md", type: "file" }]
              }
              onSelect={setSelectedFile}
              selectedFile={selectedFile}
            />
            {filesQuery.data?.truncated && (
              <p className="p-2 text-muted-foreground text-xs">
                File list truncated.
              </p>
            )}
          </nav>
        </aside>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {selectedFile === "SKILL.md" ? (
            <div className="space-y-6">
              <SkillDetailContent
                createdBy={createdBy}
                editBody={editBody}
                editing={editing}
                editNote={editNote}
                onCancelEdit={handleCancelEdit}
                onEditBodyChange={setEditBody}
                onEditNoteChange={setEditNote}
                onSaveEdit={() => void handleSaveEdit()}
                onStartEdit={handleStartEdit}
                saveBusy={patchSkillMutation.isPending}
                saveError={saveError}
                showTitle={false}
                skill={skill}
                usageSummary={usageSummary}
              />
              <SkillVersionHistory
                disabled={editing || busy}
                orgId={orgId}
                skillId={skill.id}
              />
            </div>
          ) : (
            <SkillFilePreview
              orgId={orgId}
              selectedFile={selectedFile}
              skillId={skill.id}
            />
          )}
        </div>
      </div>

      <RemoveSkillFromProfileDialog
        busy={busy}
        onConfirm={() => void handleRemoveConfirm()}
        onOpenChange={handleRemoveOpenChange}
        open={removeOpen}
        skillName={skill.name}
      />
    </div>
  );
}

function SkillFileTree({
  files,
  selectedFile,
  onSelect,
  disabled,
  parent = "",
}: {
  files: SkillFilesResponse["files"];
  selectedFile: string;
  onSelect: (path: string) => void;
  disabled: boolean;
  parent?: string;
}) {
  const children = files.filter((file) => {
    const separator = file.path.lastIndexOf("/");

    return (separator < 0 ? "" : file.path.slice(0, separator)) === parent;
  });

  return (
    <ul className="space-y-0.5">
      {children.map((file) => {
        const name = file.path.split("/").at(-1);

        return (
          <li key={file.path}>
            {file.type === "directory" ? (
              <details>
                <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-accent/50 [&::-webkit-details-marker]:hidden">
                  <ArrowRight01Icon
                    aria-hidden
                    className="size-3 shrink-0 text-muted-foreground [[open]>summary>&]:rotate-90"
                  />
                  <Folder01Icon
                    aria-hidden
                    className="size-4 shrink-0 text-muted-foreground [[open]>summary>&]:hidden"
                  />
                  <FolderOpenIcon
                    aria-hidden
                    className="hidden size-4 shrink-0 text-muted-foreground [[open]>summary>&]:block"
                  />
                  <span className="truncate">{name}</span>
                </summary>
                <div className="ml-3 pl-1">
                  <SkillFileTree
                    disabled={disabled}
                    files={files}
                    onSelect={onSelect}
                    parent={file.path}
                    selectedFile={selectedFile}
                  />
                </div>
              </details>
            ) : (
              <button
                aria-current={file.path === selectedFile ? "page" : undefined}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md py-2 pr-2 pl-7 text-left text-sm hover:bg-accent/50 disabled:opacity-50",
                  file.path === selectedFile && "bg-accent font-medium"
                )}
                disabled={disabled}
                onClick={() => onSelect(file.path)}
                title={file.path}
                type="button"
              >
                <File02Icon
                  aria-hidden
                  className="size-4 shrink-0 text-muted-foreground"
                />
                <span className="truncate">{name}</span>
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function BackLink() {
  const [searchParams] = useSearchParams();
  const { href, label } = skillDetailBackTarget(searchParams);

  return (
    <Button
      className="-ml-2 w-fit"
      render={<Link to={href} />}
      size="sm"
      type="button"
      variant="ghost"
    >
      <ArrowLeft02Icon aria-hidden className="size-4" strokeWidth={1.75} />
      {label}
    </Button>
  );
}

function PageState({ message }: { message: string }) {
  return (
    <div className="px-6 py-4">
      <div
        className={cn(
          sectionClass,
          "flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-muted-foreground text-sm"
        )}
      >
        <Spinner className="size-5" />
        {message}
      </div>
    </div>
  );
}

import type { SkillFilesResponse, SkillVersion } from "@nakama/core/contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { buildFileDiffRows, FileDiff } from "@/components/file-diff";
import {
  formatSessionRelativeTime,
  formatSessionTimestamp,
} from "@/lib/chat-history";

const versionKindLabels: Record<SkillVersion["kind"], string> = {
  created: "Created",
  original: "Original",
  restored: "Restored",
  updated: "Updated",
};

const versionSourceLabels: Record<
  NonNullable<SkillVersion["source"]>,
  string
> = {
  dashboard: "Dashboard",
  pack_import: "Pack import",
  skill_manage: "Agent",
  super_bot: "Super Bot",
};

function versionAuthor(version: SkillVersion): string {
  if (version.actorName) {
    return version.actorName;
  }

  if (version.kind === "original") {
    return "Before history";
  }

  return version.source ? versionSourceLabels[version.source] : "System";
}

function VersionTimelineItem({
  badge,
  children,
  current = false,
  label,
  last,
  onToggle,
  open,
  pill,
  subtitle,
  suggested = false,
  title,
}: {
  badge: string;
  children?: ReactNode;
  current?: boolean;
  label: string;
  last: boolean;
  onToggle: () => void;
  open: boolean;
  pill?: string;
  subtitle: ReactNode;
  suggested?: boolean;
  title: string | null;
}) {
  return (
    <li className="relative pl-11">
      {!last && (
        <span
          aria-hidden
          className="absolute top-10 bottom-0 left-4 w-px bg-border"
        />
      )}
      <span
        aria-hidden
        className={cn(
          "absolute top-3 left-0 flex size-8 items-center justify-center rounded-full border text-xs tabular-nums",
          current && "border-foreground bg-foreground text-background",
          suggested &&
            "border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
          !(current || suggested) &&
            "border-border bg-background text-muted-foreground"
        )}
      >
        {badge}
      </span>
      <button
        aria-expanded={open}
        className="w-full rounded-md px-2 py-3 text-left hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        onClick={onToggle}
        type="button"
      >
        <span className="flex items-center gap-2">
          <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
            {label}
          </span>
          {pill && (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs",
                suggested
                  ? "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
                  : "bg-muted"
              )}
            >
              {pill}
            </span>
          )}
          <span className="sr-only">{badge}</span>
        </span>
        {title && (
          <span className="mt-1 block break-words font-medium text-sm">
            {title}
          </span>
        )}
        <span className="mt-1 block text-muted-foreground text-sm">
          {subtitle}
        </span>
      </button>
      {open && children}
    </li>
  );
}

function RelativeTime({ value }: { value: string }) {
  return (
    <time dateTime={value} title={formatSessionTimestamp(value)}>
      {formatSessionRelativeTime(value)}
    </time>
  );
}

function SkillVersionHistory({
  disabled,
  orgId,
  skillId,
}: {
  disabled: boolean;
  orgId: string;
  skillId: string;
}) {
  const queryClient = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);

  const versionsQuery = useQuery({
    enabled: Boolean(orgId),
    queryFn: () => client.listSkillVersions(skillId, orgId),
    queryKey: [...queryKeys.skills.detail(skillId), "versions", orgId],
  });

  const restoreMutation = useMutation({
    mutationFn: (versionId: string) =>
      client.restoreSkillVersion(skillId, versionId, orgId),
    onError: (error) => toast(formatError(error)),
    onSuccess: async () => {
      setOpenId(null);
      await invalidateQueries(
        queryClient,
        queryKeys.skills.all,
        queryKeys.skills.detail(skillId)
      );
    },
  });

  const versions = versionsQuery.data?.versions ?? [];
  const pending = versionsQuery.data?.pending ?? [];
  const currentContent = versionsQuery.data?.currentContent ?? null;
  const nextVersion = (versions[0]?.version ?? 0) + 1;
  const toggle = (id: string) => setOpenId(openId === id ? null : id);

  return (
    <section
      aria-labelledby="skill-version-history"
      className="overflow-hidden rounded-lg border border-border bg-card"
    >
      <h2
        className="border-border border-b px-4 py-3 font-medium text-sm"
        id="skill-version-history"
      >
        Version history
      </h2>
      {versionsQuery.isLoading && (
        <p className="px-4 py-3 text-muted-foreground text-sm" role="status">
          Loading versions…
        </p>
      )}
      {versionsQuery.error && (
        <p className="px-4 py-3 text-destructive text-sm" role="alert">
          {formatError(versionsQuery.error)}{" "}
          <Button
            className="h-auto p-0"
            onClick={() => void versionsQuery.refetch()}
            type="button"
            variant="link"
          >
            Retry
          </Button>
        </p>
      )}
      {versionsQuery.isSuccess &&
        versions.length === 0 &&
        pending.length === 0 && (
          <p className="px-4 py-3 text-muted-foreground text-sm">
            No changes yet.
          </p>
        )}
      {(versions.length > 0 || pending.length > 0) && (
        <ol className="px-4 py-2">
          {pending.map((proposal, index) => (
            <VersionTimelineItem
              badge={`v${nextVersion + index}`}
              key={proposal.id}
              label="Suggested"
              last={index === pending.length - 1 && versions.length === 0}
              onToggle={() => toggle(proposal.id)}
              open={openId === proposal.id}
              pill="Pending review"
              subtitle={
                <>
                  {proposal.proposedByName ?? "Agent"}
                  {" · "}
                  <RelativeTime value={proposal.createdAt} />
                </>
              }
              suggested
              title={null}
            >
              <FileDiff
                className="mb-3 overflow-hidden rounded-md border border-border"
                rows={buildFileDiffRows(currentContent, proposal.content)}
                wrap
              />
            </VersionTimelineItem>
          ))}
          {versions.map((version, index) => {
            const current = index === 0;

            return (
              <VersionTimelineItem
                badge={`v${version.version}`}
                current={current}
                key={version.id}
                label={versionKindLabels[version.kind]}
                last={index === versions.length - 1}
                onToggle={() => toggle(version.id)}
                open={openId === version.id}
                pill={current ? "Current" : undefined}
                subtitle={
                  <>
                    {versionAuthor(version)}
                    {" · "}
                    <RelativeTime value={version.createdAt} />
                  </>
                }
                title={version.note}
              >
                <FileDiff
                  className="mb-3 overflow-hidden rounded-md border border-border"
                  rows={buildFileDiffRows(
                    versions[index + 1]?.content ?? null,
                    version.content
                  )}
                  wrap
                />
                {!current && (
                  <Button
                    className="mb-3"
                    disabled={disabled || restoreMutation.isPending}
                    onClick={() => restoreMutation.mutate(version.id)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {restoreMutation.isPending ? (
                      <Spinner className="size-4" />
                    ) : (
                      "Restore this version"
                    )}
                  </Button>
                )}
              </VersionTimelineItem>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function SkillFilePreview({
  orgId,
  selectedFile,
  skillId,
}: {
  orgId: string;
  selectedFile: string;
  skillId: string;
}) {
  const fileQuery = useQuery({
    enabled: Boolean(orgId) && selectedFile !== "SKILL.md",
    queryFn: () => client.readSkillFile(skillId, selectedFile, orgId),
    queryKey: [
      ...queryKeys.skills.detail(skillId),
      "file",
      orgId,
      selectedFile,
    ],
  });

  return (
    <div className="space-y-4">
      <h2 className="break-all font-medium text-sm">{selectedFile}</h2>
      {fileQuery.isLoading && <p role="status">Loading file…</p>}
      {fileQuery.error && (
        <div role="alert">
          <p className="text-destructive text-sm">
            {formatError(fileQuery.error)}
          </p>
          <Button onClick={() => void fileQuery.refetch()} variant="outline">
            Retry
          </Button>
        </div>
      )}
      {fileQuery.data?.content != null && (
        <CodeBlock
          className="rounded-lg border border-border"
          code={fileQuery.data.content}
          lang={selectedFile.endsWith(".md") ? "markdown" : "text"}
        />
      )}
      {fileQuery.data?.image && (
        <div className="flex justify-center rounded-lg border border-border bg-muted/20 p-4">
          <img
            alt={selectedFile}
            className="max-h-[70vh] max-w-full object-contain"
            src={`data:${fileQuery.data.image.mediaType};base64,${fileQuery.data.image.dataBase64}`}
          />
        </div>
      )}
      {fileQuery.data?.unavailableReason && (
        <p className="text-muted-foreground text-sm">
          {fileQuery.data.unavailableReason}
        </p>
      )}
    </div>
  );
}
