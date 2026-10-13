import { Tabs } from "@base-ui/react/tabs";
import type {
  OrgRole,
  OrgUsageLeader,
  OrgUsageSummaryResponse,
} from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import { Card } from "@nakama/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nakama/ui/dialog";
import { Input } from "@nakama/ui/input";
import { Spinner } from "@nakama/ui/spinner";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown01Icon, Tick02Icon } from "hugeicons-react";
import { type FormEvent, type ReactNode, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { ProfileCreateDialog } from "@/components/ProfileCreateDialog";
import {
  OrgMemberInviteForm,
  OrgMemberPicker,
} from "@/components/settings/org-member-dialogs";
import { OrgMemberRoleCards } from "@/components/settings/org-member-role-select";
import { OrgMembersTable } from "@/components/settings/org-members-table";
import { useAuth } from "@/context/use-auth";
import {
  useAcpAgentPresetsQuery,
  useOrgProfilesQuery,
  useToolsQuery,
} from "@/hooks/use-app-queries";
import {
  useAddOrgMember,
  useInviteOrgMember,
  useOrganizationOverview,
  useOrgMembers,
  useOrgUsageSummary,
  useParentOrgMembers,
} from "@/hooks/use-org-members";
import { formatError } from "@/lib/client";
import { PAGE_PATHS } from "@/lib/navigation";
import { canArchiveOrganization } from "@/lib/org-archive";
import { queryKeys } from "@/lib/query-keys";
import { SpendChart } from "@/pages/StatusPage";

const dialogTabClass =
  "whitespace-nowrap rounded-md px-3 py-1.5 text-center font-medium text-muted-foreground text-sm outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[active]:bg-background data-[active]:text-foreground data-[active]:shadow-sm";

type TeamStep = {
  action: string;
  description: string;
  done: boolean;
  onOpen: () => void;
  title: string;
};

function ProgressRing({ done, total }: { done: number; total: number }) {
  const radius = 20;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="relative size-11 shrink-0">
      <svg aria-hidden className="size-11 -rotate-90" viewBox="0 0 48 48">
        <circle
          className="stroke-muted"
          cx="24"
          cy="24"
          fill="none"
          r={radius}
          strokeWidth="4"
        />
        <circle
          className="stroke-primary"
          cx="24"
          cy="24"
          fill="none"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - done / total)}
          strokeLinecap="round"
          strokeWidth="4"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-semibold text-xs">
        {done}/{total}
      </span>
    </div>
  );
}

function TeamCreateUserPane({
  onClose,
  onRoleChange,
  orgId,
  parentOrgId,
  role,
}: {
  onClose: () => void;
  onRoleChange: (role: OrgRole) => void;
  orgId: string;
  parentOrgId: string;
  role: OrgRole;
}) {
  const queryClient = useQueryClient();
  const addMutation = useAddOrgMember(orgId);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [credentials, setCredentials] = useState<{
    email: string;
    temporaryPassword: string;
  } | null>(null);

  function handleCreate(event: FormEvent) {
    event.preventDefault();

    const trimmedName = name.trim();
    const trimmedEmail = email.trim();

    if (!(trimmedName && trimmedEmail)) {
      setError("Name and email are required.");

      return;
    }

    setError(null);
    addMutation.mutate(
      { email: trimmedEmail, name: trimmedName, phone: "", role },
      {
        onError: (cause) => setError(formatError(cause)),
        onSuccess: (result) => {
          void queryClient.invalidateQueries({
            queryKey: queryKeys.organizationOverview(parentOrgId, orgId),
          });

          if (result.temporaryPassword) {
            setCredentials({
              email: result.member.email,
              temporaryPassword: result.temporaryPassword,
            });

            return;
          }

          onClose();
        },
      }
    );
  }

  if (credentials) {
    return (
      <div className="space-y-4">
        <p className="text-muted-foreground text-sm">
          Share these login details once. They will not be shown again.
        </p>
        <p className="text-sm">{credentials.email}</p>
        <code className="block rounded-md border border-border bg-muted/30 px-2 py-1.5 text-xs">
          {credentials.temporaryPassword}
        </code>
        <DialogFooter>
          <Button onClick={onClose} type="button">
            Done
          </Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <form className="space-y-4" onSubmit={handleCreate}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label
            className="mb-1.5 block font-medium text-sm"
            htmlFor="team-create-name"
          >
            Name
          </label>
          <Input
            className="h-10 rounded-xl"
            id="team-create-name"
            onChange={(event) => setName(event.target.value)}
            placeholder="Jane Doe"
            required
            value={name}
          />
        </div>
        <div>
          <label
            className="mb-1.5 block font-medium text-sm"
            htmlFor="team-create-email"
          >
            Email
          </label>
          <Input
            className="h-10 rounded-xl"
            id="team-create-email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="jane@example.com"
            required
            type="email"
            value={email}
          />
        </div>
      </div>
      <div>
        <p className="mb-1.5 font-medium text-sm">Role</p>
        <OrgMemberRoleCards onChange={onRoleChange} value={role} />
      </div>
      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button onClick={onClose} type="button" variant="outline">
          Cancel
        </Button>
        <Button disabled={addMutation.isPending} type="submit">
          {addMutation.isPending ? "Creating…" : "Create user"}
        </Button>
      </DialogFooter>
    </form>
  );
}

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
  const [inviting, setInviting] = useState(false);
  const [tab, setTab] = useState<"create" | "invite">("create");
  const [inviteEmail, setInviteEmail] = useState("");
  const inviteMutation = useInviteOrgMember(orgId);

  const noCandidates =
    candidates.isSuccess && candidates.data.members.length === 0;

  const showInvite = inviting || noCandidates;

  function handleInvite(event: FormEvent) {
    event.preventDefault();

    const email = inviteEmail.trim();

    if (!email) {
      setError("Email is required.");

      return;
    }

    setError(null);
    inviteMutation.mutate(
      { email, role },
      {
        onError: (cause) => setError(formatError(cause)),
        onSuccess: () => {
          void queryClient.invalidateQueries({
            queryKey: queryKeys.organizationOverview(parentOrgId, orgId),
          });
          handleOpenChange(false);
        },
      }
    );
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      setInviting(false);
      setTab("create");
      setInviteEmail("");
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
        {showInvite && (
          <Tabs.Root
            onValueChange={(value) => {
              setError(null);
              setTab(value === "invite" ? "invite" : "create");
            }}
            value={tab}
          >
            <Tabs.List
              aria-label="Add person"
              className="grid w-fit auto-cols-fr grid-flow-col gap-1 rounded-lg bg-muted p-1"
            >
              <Tabs.Tab className={dialogTabClass} value="create">
                Create user
              </Tabs.Tab>
              <Tabs.Tab className={dialogTabClass} value="invite">
                Invite by email
              </Tabs.Tab>
            </Tabs.List>
          </Tabs.Root>
        )}
        {showInvite && tab === "invite" && (
          <div className="-mx-4 -mb-4 overflow-hidden rounded-b-xl">
            <OrgMemberInviteForm
              formError={error}
              inviteEmail={inviteEmail}
              inviteRole={role}
              onCancel={() => handleOpenChange(false)}
              onInviteEmailChange={setInviteEmail}
              onInviteRoleChange={setRole}
              onSubmit={handleInvite}
              pending={inviteMutation.isPending}
            />
          </div>
        )}
        {showInvite && tab === "create" && (
          <TeamCreateUserPane
            onClose={() => handleOpenChange(false)}
            onRoleChange={setRole}
            orgId={orgId}
            parentOrgId={parentOrgId}
            role={role}
          />
        )}
        {!showInvite && (
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
                onClick={() => {
                  setError(null);
                  setInviting(true);
                }}
                type="button"
                variant="ghost"
              >
                New user or invite
              </Button>
              <Button
                onClick={() => handleOpenChange(false)}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                disabled={addMutation.isPending || !selected}
                type="submit"
              >
                {addMutation.isPending ? "Adding…" : "Add person"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReadinessCard({
  busy,
  doneCount,
  nextStep,
  onOpen,
  steps,
  total,
}: {
  busy: boolean;
  doneCount: number;
  nextStep: TeamStep;
  onOpen: (open: () => void) => void;
  steps: TeamStep[];
  total: number;
}) {
  return (
    <Card className="gap-0 overflow-hidden py-0 shadow-none">
      <div className="flex items-center gap-4 px-4 py-3">
        <ProgressRing done={doneCount} total={total} />
        <div className="space-y-0">
          <h3 className="font-semibold">Get your team ready</h3>
          <p className="text-muted-foreground text-sm">
            {total - doneCount === 0
              ? "All steps done"
              : `${total - doneCount} ${total - doneCount === 1 ? "step" : "steps"} left`}
          </p>
        </div>
      </div>
      <ul className="divide-y divide-border border-border border-t">
        <li className="flex items-center gap-3 px-4 py-2.5 text-muted-foreground">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Tick02Icon aria-hidden className="size-3.5" />
          </span>
          <span className="line-through">Create your team</span>
        </li>
        {steps.map((step, index) => {
          const active = step === nextStep;

          return (
            <li
              className={`flex items-center gap-3 px-4 py-2.5 ${active ? "bg-primary/5" : ""}`}
              key={step.title}
            >
              {step.done ? (
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Tick02Icon aria-hidden className="size-3.5" />
                </span>
              ) : (
                <span
                  aria-hidden
                  className={`flex size-6 shrink-0 items-center justify-center rounded-full border-2 font-semibold text-xs ${active ? "border-primary text-primary" : "border-border text-muted-foreground"}`}
                >
                  {index + 2}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p
                  className={
                    step.done
                      ? "text-muted-foreground line-through"
                      : "font-medium"
                  }
                >
                  {step.title}
                </p>
                {!step.done && (
                  <p className="text-muted-foreground text-sm">
                    {step.description}
                  </p>
                )}
              </div>
              {!step.done && (
                <Button
                  disabled={busy}
                  onClick={() => onOpen(step.onOpen)}
                  size="sm"
                  type="button"
                  variant={active ? "default" : "outline"}
                >
                  {step.action}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function TeamPeopleAndAgents({
  canManage,
  onAddAgent,
  onAddPerson,
  orgId,
}: {
  canManage: boolean;
  onAddAgent: () => void;
  onAddPerson: () => void;
  orgId: string;
}) {
  const { data: membersData } = useOrgMembers(canManage ? orgId : null);
  const { data: agents } = useOrgProfilesQuery(orgId);
  const { user } = useAuth();

  return (
    <>
      {canManage && (
        <TeamList
          action="Add person"
          empty="No people yet"
          items={membersData?.members.map((member) => ({
            id: member.userId,
            name: member.email,
          }))}
          onAction={onAddPerson}
          title="People"
        >
          <OrgMembersTable
            currentUserEmail={user?.email}
            isLoading={false}
            members={membersData?.members ?? []}
            removePending={false}
            updatePending={false}
          />
        </TeamList>
      )}
      <TeamList
        action="Add agent"
        empty="No agents yet"
        items={agents
          ?.filter((agent) => !agent.isSuper)
          .map((agent) => ({
            avatar: (
              <ProfileAvatar
                className="rounded-md outline-none"
                profile={agent}
                size="sm"
              />
            ),
            id: agent.id,
            name: agent.name,
          }))}
        onAction={canManage ? onAddAgent : undefined}
        title="Agents"
      />
    </>
  );
}

function TeamStats({ usage }: { usage: OrgUsageSummaryResponse }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const change = usage.requests7d - usage.requestsPrev7d;

  const stats = [
    {
      detail: `${change >= 0 ? "+" : ""}${change} from last week`,
      label: "AI calls this week",
      value: usage.requests7d.toLocaleString(),
    },
    {
      detail: "Approximate",
      label: "Spent in the last 30 days",
      value: `$${usage.costUsd30d.toFixed(2)}`,
    },
    {
      detail: usage.topAgent
        ? `${usage.topAgent.requestCount.toLocaleString()} AI calls`
        : "Not used yet",
      label: "Busiest agent",
      value: usage.topAgent?.name ?? "-",
    },
  ];

  return (
    <Card className="gap-0 py-0 shadow-none">
      <div className="grid grid-cols-3 divide-x divide-border">
        {stats.map((stat) => (
          <div className="min-w-0 px-4 py-2.5" key={stat.label}>
            <p className="text-muted-foreground text-xs">{stat.label}</p>
            <p className="truncate font-semibold text-lg">{stat.value}</p>
            <p className="truncate text-muted-foreground text-xs">
              {stat.detail}
            </p>
          </div>
        ))}
      </div>
      {usage.daily.length > 1 ? (
        <div className="border-border border-t px-4 py-3">
          <SpendChart
            daily={usage.daily}
            metric={(day) => day.estimatedCostUsd}
            onSelect={setActiveIndex}
            selected={activeIndex ?? usage.daily.length - 1}
          />
        </div>
      ) : null}
      <div className="grid divide-border border-border border-t sm:grid-cols-2 sm:divide-x">
        <TeamLeaderboard leaders={usage.people} title="People" />
        <TeamLeaderboard leaders={usage.agents} title="Agents" />
      </div>
    </Card>
  );
}

function TeamLeaderboard({
  leaders,
  title,
}: {
  leaders: OrgUsageLeader[];
  title: string;
}) {
  const top = leaders[0]?.requestCount ?? 0;

  return (
    <div className="min-w-0 space-y-2 px-4 py-3">
      <h3 className="text-muted-foreground text-xs">{title}</h3>
      {leaders.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nobody yet</p>
      ) : (
        <ol className="space-y-2">
          {leaders.map((leader, index) => (
            <li className="text-sm" key={leader.name}>
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate">
                  <span className="mr-2 text-muted-foreground tabular-nums">
                    {index + 1}
                  </span>
                  {leader.name}
                </span>
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {leader.requestCount.toLocaleString()} AI calls
                </span>
              </div>
              <div className="mt-1 h-1 rounded-full bg-muted">
                <div
                  className="h-1 rounded-full bg-primary/60"
                  style={{
                    width: `${top > 0 ? (leader.requestCount / top) * 100 : 0}%`,
                  }}
                />
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function TeamList({
  action,
  empty,
  items,
  onAction,
  title,
  children,
}: {
  action: string;
  children?: ReactNode;
  empty: string;
  items:
    | { avatar?: ReactNode; detail?: string; id: string; name: string }[]
    | undefined;
  onAction?: () => void;
  title: string;
}) {
  return (
    <Card className="gap-0 overflow-hidden py-0 shadow-none">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        <h3 className="font-semibold">
          {title}
          {items ? ` (${items.length})` : ""}
        </h3>
        {onAction && (
          <Button onClick={onAction} size="sm" type="button" variant="outline">
            {action}
          </Button>
        )}
      </div>
      {children && items && items.length > 0 ? (
        <div className="border-border border-t">{children}</div>
      ) : null}
      {items?.length === 0 && (
        <p className="border-border border-t px-4 py-2.5 text-muted-foreground text-sm">
          {empty}
        </p>
      )}
      {!children && items && items.length > 0 && (
        <ul className="divide-y divide-border border-border border-t">
          {items.map((item) => (
            <li
              className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
              key={item.id}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                {item.avatar}
                <span className="truncate font-medium">{item.name}</span>
              </span>
              {item.detail && (
                <span className="shrink-0 text-muted-foreground">
                  {item.detail}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DeleteTeamDialog({
  deleting,
  error,
  onConfirm,
  onOpenChange,
  open,
  teamName,
}: {
  deleting: boolean;
  error: string | null;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  teamName: string;
}) {
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!(open || deleting)) {
          onOpenChange(false);
        }
      }}
      open={open}
    >
      <DialogContent className="gap-6 p-6 sm:max-w-md">
        <DialogHeader className="gap-3">
          <DialogTitle>Delete team?</DialogTitle>
          <DialogDescription>
            {teamName} will disappear from the switcher and chat. Members,
            profiles, and files stay on disk. Nakama cannot restore it.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        )}
        <DialogFooter className="mx-0 mb-0 gap-2 border-0 bg-transparent p-0 sm:flex-row sm:justify-end">
          <Button
            disabled={deleting}
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            disabled={deleting}
            onClick={onConfirm}
            type="button"
            variant="destructive"
          >
            {deleting ? <Spinner className="size-4" /> : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TeamHeader({
  busy,
  onWork,
  showWork,
  team,
}: {
  busy: boolean;
  onWork: () => void;
  showWork: boolean;
  team: { memberCount: number; name: string };
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 space-y-1">
        <TeamBreadcrumb name={team.name} />
        <h2 className="break-words font-semibold text-xl">{team.name}</h2>
        <p className="text-muted-foreground text-sm">
          {team.memberCount} {team.memberCount === 1 ? "person" : "people"}
        </p>
      </div>
      {showWork && (
        <Button disabled={busy} onClick={onWork} type="button">
          Work in this team
        </Button>
      )}
    </div>
  );
}

function TeamBreadcrumb({ name }: { name: string }) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex flex-wrap items-center pb-3 text-sm"
    >
      <ol className="flex min-w-0 flex-wrap items-center gap-2">
        <li>
          <Link
            className="text-muted-foreground transition-colors hover:text-foreground"
            to={PAGE_PATHS.organization}
          >
            Teams
          </Link>
        </li>
        <li aria-hidden className="text-muted-foreground/60">
          /
        </li>
        <li
          aria-current="page"
          className="min-w-0 truncate font-semibold text-foreground"
        >
          {name}
        </li>
      </ol>
    </nav>
  );
}

function TeamMissing({ loading }: { loading: boolean }) {
  return (
    <section className="mx-auto min-w-0 max-w-3xl space-y-3">
      <Link
        className="text-muted-foreground text-sm"
        to={PAGE_PATHS.organization}
      >
        Back to organization
      </Link>
      <p className="text-muted-foreground text-sm" role="status">
        {loading ? "Loading team…" : "Team not found"}
      </p>
    </section>
  );
}

function TeamAdminCard({
  team,
}: {
  team: { id: string; name: string; slug: string };
}) {
  const { archiveOrg, user } = useAuth();
  const navigate = useNavigate();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function deleteTeam() {
    setDeleting(true);
    setDeleteError(null);

    try {
      await archiveOrg(team.id);
      setDeleteOpen(false);
      navigate(PAGE_PATHS.organization);
    } catch (cause) {
      setDeleteError(formatError(cause));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Card className="gap-0 py-0 shadow-none">
        <details className="group">
          <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-2.5">
            <span className="font-semibold">Technical details</span>
            <span className="flex items-center gap-2 text-muted-foreground text-sm">
              For admins and support
              <ArrowDown01Icon
                aria-hidden
                className="size-4 transition-transform group-open:rotate-180"
              />
            </span>
          </summary>
          <dl className="space-y-2 border-border border-t px-4 py-2.5 text-sm">
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
        {canArchiveOrganization(user?.isPlatformAdmin === true) && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-border border-t px-4 py-2.5">
            <h3 className="font-semibold">Delete team</h3>
            <Button
              onClick={() => {
                setDeleteError(null);
                setDeleteOpen(true);
              }}
              size="sm"
              type="button"
              variant="destructive"
            >
              Delete
            </Button>
          </div>
        )}
      </Card>
      <DeleteTeamDialog
        deleting={deleting}
        error={deleteError}
        onConfirm={() => void deleteTeam()}
        onOpenChange={setDeleteOpen}
        open={deleteOpen}
        teamName={team.name}
      />
    </>
  );
}

function useTeam(
  teamId: string | undefined,
  activeOrg: { id: string; parentOrgId?: string | null } | null | undefined
) {
  const overview = useOrganizationOverview(
    activeOrg?.id ?? null,
    activeOrg?.parentOrgId ?? null
  );

  const foundTeam = overview.data?.teams.find((entry) => entry.id === teamId);
  const [lastTeam, setLastTeam] = useState(foundTeam);

  if (foundTeam && foundTeam !== lastTeam) {
    setLastTeam(foundTeam);
  }

  return {
    loading: overview.isLoading,
    team: foundTeam ?? (lastTeam?.id === teamId ? lastTeam : undefined),
  };
}

export function TeamDetailPage() {
  const { teamId } = useParams();
  const { activeOrg, orgs, switchOrg, user } = useAuth();
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addAgentOpen, setAddAgentOpen] = useState(false);
  const { data: tools = [] } = useToolsQuery();
  const { data: agentPresets = [] } = useAcpAgentPresetsQuery();

  const { loading, team } = useTeam(teamId, activeOrg);
  const { data: usage } = useOrgUsageSummary(team?.id ?? null);

  if (!team) {
    return <TeamMissing loading={loading} />;
  }

  const canWork = team.isCurrent || team.canSwitch;

  const canManage =
    user?.isPlatformAdmin === true ||
    orgs.find((org) => org.id === team.id)?.role === "admin";

  const showAddPerson = () => setAddOpen(true);
  const showAddAgent = () => setAddAgentOpen(true);
  const addActions = { agent: showAddAgent, person: showAddPerson };

  const steps: TeamStep[] = [
    ...(canManage
      ? [
          {
            action: "Add person",
            description: "So they can work with the team",
            done: team.memberCount > 1,
            onOpen: showAddPerson,
            title: "Invite your teammates",
          },
        ]
      : []),
    ...(canManage
      ? [
          {
            action: "Add agent",
            description: "An AI helper that does tasks for the team",
            done: team.localResourceCounts.agents > 0,
            onOpen: showAddAgent,
            title: "Add your first agent",
          },
        ]
      : []),
  ];

  const doneCount = steps.filter((step) => step.done).length + 1;
  const total = steps.length + 1;
  const nextStep = steps.find((step) => !step.done);

  async function openIn(open: () => void) {
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

      open();
    } catch (cause) {
      setError(formatError(cause));
    } finally {
      running.current = false;
      setPending(false);
    }
  }

  return (
    <section className="mx-auto min-w-0 max-w-3xl space-y-5">
      <TeamHeader
        busy={pending}
        onWork={() => void openIn(() => navigate(PAGE_PATHS.chat))}
        showWork={canWork && !team.isCurrent}
        team={team}
      />
      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}
      {nextStep && (
        <ReadinessCard
          busy={pending || !canWork}
          doneCount={doneCount}
          nextStep={nextStep}
          onOpen={(open) => void openIn(open)}
          steps={steps}
          total={total}
        />
      )}
      {usage && <TeamStats usage={usage} />}
      <TeamPeopleAndAgents
        canManage={canManage}
        onAddAgent={() => void openIn(addActions.agent)}
        onAddPerson={() => void openIn(addActions.person)}
        orgId={team.id}
      />
      {canManage && <TeamAdminCard team={team} />}
      <ProfileCreateDialog
        agentPresets={agentPresets}
        onCreated={() => undefined}
        onOpenChange={setAddAgentOpen}
        open={addAgentOpen}
        tools={tools}
      />
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
