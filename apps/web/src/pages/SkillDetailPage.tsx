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
import { useState } from "react";
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
        input: { body: editBody },
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
            <SkillDetailContent
              createdBy={createdBy}
              editBody={editBody}
              editing={editing}
              onCancelEdit={handleCancelEdit}
              onEditBodyChange={setEditBody}
              onSaveEdit={() => void handleSaveEdit()}
              onStartEdit={handleStartEdit}
              saveBusy={patchSkillMutation.isPending}
              saveError={saveError}
              showTitle={false}
              skill={skill}
              usageSummary={usageSummary}
            />
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

import type { SkillFilesResponse } from "@nakama/core/contract";
import { useQuery } from "@tanstack/react-query";

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
