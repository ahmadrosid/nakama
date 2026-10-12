import type { OrgRole } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import { Card } from "@nakama/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nakama/ui/dialog";
import { useQueryClient } from "@tanstack/react-query";
import { Tick02Icon } from "hugeicons-react";
import { type FormEvent, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { OrgMemberPicker } from "@/components/settings/org-member-dialogs";
import { OrgMemberRoleCards } from "@/components/settings/org-member-role-select";
import { useAuth } from "@/context/use-auth";
import {
  useAddOrgMember,
  useOrganizationOverview,
  useParentOrgMembers,
} from "@/hooks/use-org-members";
import { formatError } from "@/lib/client";
import { PAGE_PATHS } from "@/lib/navigation";
import { queryKeys } from "@/lib/query-keys";

type TeamStep = {
  action: string;
  description: string;
  done: boolean;
  path?: string;
  title: string;
};

function TeamAddPersonDialog({
  orgId,
  parentOrgId,
  open,
  onOpenChange,
}: {
  orgId: string;
  parentOrgId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const addMutation = useAddOrgMember(orgId);
  const candidates = useParentOrgMembers(orgId, open);
  const [selected, setSelected] = useState("");
  const [role, setRole] = useState<OrgRole>("member");
  const [error, setError] = useState<string | null>(null);

  function handleOpenChange(next: boolean) {
    if (!next) {
      setSelected("");
      setRole("member");
      setError(null);
    }

    onOpenChange(next);
  }

  function submit(event: FormEvent) {
    event.preventDefault();

    const person = candidates.data?.members.find(
      (member) => member.userId === selected
    );

    if (!person) {
      setError("Select a person to add.");

      return;
    }

    setError(null);
    addMutation.mutate(
      {
        email: person.email,
        name: person.name?.trim() || person.email,
        phone: "",
        role,
      },
      {
        onError: (cause) => setError(formatError(cause)),
        onSuccess: () => {
          void queryClient.invalidateQueries({
            queryKey: queryKeys.organizationOverview(parentOrgId, orgId),
          });
          void queryClient.invalidateQueries({
            queryKey: queryKeys.orgParentMembers(orgId),
          });
          handleOpenChange(false);
        },
      }
    );
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add person</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <OrgMemberPicker
            disabled={addMutation.isPending}
            isLoading={candidates.isLoading}
            members={candidates.data?.members ?? []}
            name="team-person"
            onChange={setSelected}
            value={selected}
          />
          <div>
            <p className="mb-1.5 font-medium text-sm">Role</p>
            <OrgMemberRoleCards onChange={setRole} value={role} />
          </div>
          {(error || candidates.isError) && (
            <p className="text-destructive text-sm" role="alert">
              {error ?? formatError(candidates.error)}
            </p>
          )}
          <DialogFooter>
            <Button
              onClick={() => handleOpenChange(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button disabled={addMutation.isPending || !selected} type="submit">
              {addMutation.isPending ? "Adding…" : "Add person"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TeamDetailPage() {
  const { teamId } = useParams();
  const { activeOrg, switchOrg } = useAuth();
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const [addOpen, setAddOpen] = useState(false);

  const overview = useOrganizationOverview(
    activeOrg?.id ?? null,
    activeOrg?.parentOrgId ?? null
  );

  const team = overview.data?.teams.find((entry) => entry.id === teamId);

  if (!team) {
    return (
      <section className="mx-auto min-w-0 max-w-3xl space-y-3">
        <Link
          className="text-muted-foreground text-sm"
          to={PAGE_PATHS.organization}
        >
          Back to organization
        </Link>
        <p className="text-muted-foreground text-sm" role="status">
          {overview.isLoading ? "Loading team…" : "Team not found"}
        </p>
      </section>
    );
  }

  const canWork = team.isCurrent || team.canSwitch;

  const steps: TeamStep[] = [
    {
      action: "Add person",
      description: "So they can work with the team",
      done: team.memberCount > 1,
      title: "Invite your teammates",
    },
    {
      action: "Add agent",
      description: "An AI helper that does tasks for the team",
      done: team.localResourceCounts.agents > 0,
      path: PAGE_PATHS.profiles,
      title: "Add your first agent",
    },
    {
      action: "Add knowledge",
      description: "Knowledge your agents can read",
      done: team.localResourceCounts.knowledge > 0,
      path: PAGE_PATHS.profiles,
      title: "Share documents and notes",
    },
    {
      action: "Add skill",
      description: "Step-by-step know-how agents can follow",
      done: team.localResourceCounts.skills > 0,
      path: PAGE_PATHS.skills,
      title: "Teach a skill",
    },
  ];

  const doneCount = steps.filter((step) => step.done).length + 1;
  const total = steps.length + 1;

  async function openIn(path?: string) {
    if (running.current || !team) {
      return;
    }

    running.current = true;
    setPending(true);
    setError(null);

    try {
      if (!team.isCurrent) {
        await switchOrg(team.id);
      }

      if (path) {
        navigate(path);
      } else {
        setAddOpen(true);
      }
    } catch (cause) {
      setError(formatError(cause));
    } finally {
      running.current = false;
      setPending(false);
    }
  }

  return (
    <section className="mx-auto min-w-0 max-w-3xl space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <Link
            className="text-muted-foreground text-sm"
            to={PAGE_PATHS.organization}
          >
            Back to organization
          </Link>
          <h2 className="break-words font-semibold text-xl">{team.name}</h2>
          <p className="text-muted-foreground text-sm">
            {team.memberCount} {team.memberCount === 1 ? "person" : "people"}
          </p>
        </div>
        {canWork && !team.isCurrent && (
          <Button
            disabled={pending}
            onClick={() => void openIn(PAGE_PATHS.chat)}
            size="sm"
            type="button"
          >
            Work in this team
          </Button>
        )}
      </div>
      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}
      <Card className="overflow-hidden shadow-none">
        <div className="space-y-0.5 px-5 py-4">
          <h3 className="font-semibold text-sm">Get your team ready</h3>
          <p className="text-muted-foreground text-xs">
            {doneCount} of {total} steps done
          </p>
        </div>
        <div className="h-1 bg-muted">
          <div
            className="h-full bg-primary"
            style={{ width: `${(doneCount / total) * 100}%` }}
          />
        </div>
        <ul className="divide-y divide-border">
          <li className="flex items-center gap-3 px-5 py-3 text-muted-foreground text-sm">
            <Tick02Icon aria-hidden className="size-5 text-primary" />
            Create your team
          </li>
          {steps.map((step) => (
            <li className="flex items-center gap-3 px-5 py-3" key={step.title}>
              {step.done ? (
                <Tick02Icon aria-hidden className="size-5 text-primary" />
              ) : (
                <span
                  aria-hidden
                  className="size-5 shrink-0 rounded-full border-2 border-border"
                />
              )}
              <div className="min-w-0 flex-1">
                <p
                  className={
                    step.done
                      ? "text-muted-foreground text-sm"
                      : "font-medium text-sm"
                  }
                >
                  {step.title}
                </p>
                {!step.done && (
                  <p className="text-muted-foreground text-xs">
                    {step.description}
                  </p>
                )}
              </div>
              {!step.done && (
                <Button
                  disabled={pending || !canWork}
                  onClick={() => void openIn(step.path)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {step.action}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <Card className="shadow-none">
        <details>
          <summary className="flex cursor-pointer items-center justify-between gap-3 px-5 py-4">
            <span className="font-medium text-sm">Technical details</span>
            <span className="text-muted-foreground text-xs">
              For admins and support
            </span>
          </summary>
          <dl className="space-y-2 border-border border-t px-5 py-4 text-sm">
            <div>
              <dt className="text-muted-foreground">Team ID</dt>
              <dd className="break-all font-mono text-xs">{team.id}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Slug</dt>
              <dd className="break-words">{team.slug}</dd>
            </div>
          </dl>
        </details>
      </Card>
      {activeOrg && (
        <TeamAddPersonDialog
          onOpenChange={setAddOpen}
          open={addOpen}
          orgId={team.id}
          parentOrgId={activeOrg.parentOrgId ?? activeOrg.id}
        />
      )}
    </section>
  );
}
