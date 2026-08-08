import { ChevronLeftIcon, Trash2Icon } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/context/use-auth";
import { useProfileQuery, useSkillQuery } from "@/hooks/use-app-queries";
import {
  usePatchSkillMutation,
  useUnassignSkillMutation,
} from "@/hooks/use-resource-mutations";
import { formatError } from "@/lib/client";
import { canAccessSystemPage, skillDetailBackTarget } from "@/lib/navigation";
import { cn } from "@/lib/utils";

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
      setSaveError(error instanceof Error ? error.message : formatError(error));
    }
  }

  return (
    <div className="flex flex-col gap-4 px-6 py-4">
      <div className="flex items-center justify-between gap-3">
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
            <Trash2Icon aria-hidden className="size-4" />
            Remove from profile
          </Button>
        ) : null}
      </div>

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
        skill={skill}
        usageSummary={usageSummary}
      />

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
      <ChevronLeftIcon aria-hidden className="size-4" />
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
