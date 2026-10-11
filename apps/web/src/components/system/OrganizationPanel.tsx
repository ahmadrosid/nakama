import type { OrgSharedResourceKind } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import { Card, CardHeader, CardTitle } from "@nakama/ui/card";
import {
  AiBrain01Icon,
  BookOpen01Icon,
  ComputerTerminal01Icon,
  TaskEdit01Icon,
  UserGroupIcon,
} from "hugeicons-react";
import { OrgArchiveCard } from "@/components/settings/OrgArchiveCard";
import { OrgMembersCard } from "@/components/settings/OrgMembersCard";
import { OrgMemoryCard } from "@/components/settings/OrgMemoryCard";
import { SkillsCuratorOrgCard } from "@/components/settings/SkillsCuratorOrgCard";
import { SkillsPostTurnReviewOrgCard } from "@/components/settings/SkillsPostTurnReviewOrgCard";
import { SkillsWriteApprovalOrgCard } from "@/components/settings/SkillsWriteApprovalOrgCard";
import { useAuth } from "@/context/use-auth";
import { useOrganizationOverview } from "@/hooks/use-org-members";
import { formatError } from "@/lib/client";

const RESOURCE_ROWS = [
  { icon: BookOpen01Icon, kind: "knowledge", label: "Knowledge" },
  { icon: TaskEdit01Icon, kind: "skill", label: "Skills" },
  { icon: UserGroupIcon, kind: "agent", label: "Agents" },
  { icon: ComputerTerminal01Icon, kind: "tool", label: "Tools" },
  { icon: AiBrain01Icon, kind: "model", label: "Models" },
] satisfies Array<{
  kind: OrgSharedResourceKind;
  label: string;
  icon: typeof BookOpen01Icon;
}>;

const READINESS_LABELS = {
  ready: "Ready",
  requires_setup: "Requires setup",
  unavailable: "Unavailable",
};

export function OrganizationOverview() {
  const { activeOrg } = useAuth();

  const overview = useOrganizationOverview(
    activeOrg?.id ?? null,
    activeOrg?.parentOrgId ?? null
  );

  if (!activeOrg) {
    return null;
  }

  if (overview.isError) {
    return (
      <div className="space-y-3" role="alert">
        <p>{formatError(overview.error)}</p>
        <Button
          disabled={overview.isFetching}
          onClick={() => void overview.refetch()}
          variant="outline"
        >
          Retry
        </Button>
      </div>
    );
  }

  if (!overview.data || overview.data.activeOrgId !== activeOrg.id) {
    return (
      <p className="text-muted-foreground text-sm" role="status">
        Loading organization…
      </p>
    );
  }

  const { organization, sharedResources, teams } = overview.data;

  return (
    <div className="space-y-6">
      <h2 className="break-words font-semibold text-xl">{organization.name}</h2>
      <Card className="overflow-hidden">
        <CardHeader className="border-b px-5 py-4">
          <CardTitle className="text-base">Shared with every team</CardTitle>
        </CardHeader>
        <dl className="divide-y">
          {RESOURCE_ROWS.map(({ kind, label, icon: Icon }) => (
            <div
              className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start"
              key={kind}
            >
              <dt className="flex shrink-0 items-center gap-2 font-medium sm:w-32">
                <Icon aria-hidden className="size-4 text-muted-foreground" />
                {label}
              </dt>
              <dd className="flex min-w-0 flex-wrap gap-2">
                {sharedResources
                  .filter((resource) => resource.resourceKind === kind)
                  .map((resource) => (
                    <span
                      className="max-w-full break-words rounded-lg bg-muted px-2.5 py-1 text-sm"
                      key={resource.id}
                      title={`Shared from ${resource.sourceOrganization.name}`}
                    >
                      {resource.label}
                      {resource.readiness !== "ready" && (
                        <span className="ml-2 text-muted-foreground">
                          {READINESS_LABELS[resource.readiness]}
                        </span>
                      )}
                    </span>
                  ))}
                {!sharedResources.some(
                  (resource) => resource.resourceKind === kind
                ) && (
                  <span className="text-muted-foreground text-sm">
                    None published
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </Card>
      <Card className="overflow-hidden">
        <CardHeader className="border-b px-5 py-4">
          <CardTitle className="text-base">Teams</CardTitle>
        </CardHeader>
        <ul className="divide-y">
          {teams.map((team) => (
            <li className="space-y-2 px-5 py-4" key={team.id}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="break-words font-medium">{team.name}</span>
                {team.id === activeOrg.id && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary text-xs">
                    Current
                  </span>
                )}
              </div>
              <p className="text-muted-foreground text-sm tabular-nums">
                {team.memberCount} members
              </p>
              <dl className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-sm tabular-nums">
                {Object.entries(team.localResourceCounts).map(
                  ([kind, count]) => (
                    <div className="flex gap-1" key={kind}>
                      <dt>{kind}</dt>
                      <dd>{count}</dd>
                    </div>
                  )
                )}
              </dl>
            </li>
          ))}
        </ul>
        {teams.length === 0 && (
          <p className="px-5 py-4 text-muted-foreground text-sm">No teams</p>
        )}
      </Card>
    </div>
  );
}

export function OrganizationPanel() {
  const { activeOrg } = useAuth();

  return (
    <div className="min-w-0 space-y-8">
      <OrganizationOverview />
      <h2 className="font-semibold text-xl">
        {activeOrg?.parentOrgId
          ? "Current team settings"
          : "Organization settings"}
      </h2>
      <OrgMembersCard />
      <SkillsWriteApprovalOrgCard />
      <SkillsPostTurnReviewOrgCard />
      <SkillsCuratorOrgCard />
      <OrgMemoryCard />
      <OrgArchiveCard />
    </div>
  );
}
