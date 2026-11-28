import type { ProfileSummary, SkillSummary } from "@nakama/core/contract";
import { BUNDLED_SKILL_NAMES } from "@nakama/core/skills/bundled-names";
import { Button } from "@nakama/ui/button";
import { Card, CardContent } from "@nakama/ui/card";
import { Input } from "@nakama/ui/input";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight01Icon, BrainIcon, Search01Icon } from "hugeicons-react";
import { type ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import { IntegrationsTabs } from "@/components/IntegrationsTabs";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { useAuth } from "@/context/use-auth";
import { useOrgPlugins } from "@/hooks/use-plugins";
import { client, formatError } from "@/lib/client";
import {
  enabledPluginNavEntries,
  integrationSectionPath,
  navHrefForPage,
  pluginIcon,
  profilePath,
  skillDetailPath,
  visibleIntegrationSections,
  visibleNavGroups,
} from "@/lib/navigation";
import { queryKeys } from "@/lib/query-keys";

const bundledSkillNames = new Set<string>(BUNDLED_SKILL_NAMES);

const skillSourceOrder = new Map([
  ["Agent-created", 1],
  ["Built-in", 0],
  ["User-added", 2],
]);

function skillSourceLabel(skill: SkillSummary): string {
  if (skill.pluginId) {
    return `Plugin: ${skill.pluginId}`;
  }

  if (skill.createdBy === "agent") {
    return "Agent-created";
  }

  if (skill.createdBy === "bundled" && bundledSkillNames.has(skill.name)) {
    return "Built-in";
  }

  return "User-added";
}

export function CustomizePage() {
  const { user, activeOrg } = useAuth();
  const { data: plugins = [], isLoading, error } = useOrgPlugins();

  const items = visibleNavGroups({
    isPlatformAdmin: user?.isPlatformAdmin === true,
    orgRole: activeOrg?.role,
  }).flatMap((group) => group.items);

  const sections = [
    {
      pages: [
        "organization",
        "files",
        "usage",
        "workers",
        "google-meet",
        "settings",
      ],
      title: "Workspace",
    },
    {
      pages: ["providers", "tools", "skills", "mcp", "plugin-management"],
      title: "Agent tools",
    },
  ].map(({ title, pages }) => ({
    items: pages.flatMap((page) => {
      const item = items.find((entry) => entry.id === page);

      return item
        ? [
            {
              href: navHrefForPage(item.id),
              icon: item.icon,
              label: item.label,
            },
          ]
        : [];
    }),
    title,
  }));

  sections.push({
    items: visibleIntegrationSections(
      user?.isPlatformAdmin === true,
      activeOrg?.role
    ).map((item) => ({
      href: integrationSectionPath(item.id),
      icon: item.icon,
      label: item.label,
    })),
    title: "Integrations",
  });
  sections.push({
    items: enabledPluginNavEntries(plugins).map((entry) => ({
      href: entry.href,
      icon: pluginIcon(entry.pluginId),
      label: entry.label,
    })),
    title: "Installed plugins",
  });

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {sections.flatMap((section) =>
        section.items.length > 0
          ? [
              <section
                aria-label={section.title}
                className="space-y-3"
                key={section.title}
              >
                <h2 className="type-section-title font-medium text-muted-foreground">
                  {section.title}
                </h2>
                <Card className="w-full overflow-hidden shadow-none">
                  <CardContent className="p-0">
                    <nav
                      aria-label={section.title}
                      className="divide-y divide-border"
                    >
                      {section.items.map(({ href, icon: Icon, label }) => (
                        <Link
                          className="flex min-w-0 items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2"
                          key={href}
                          to={href}
                        >
                          <Icon
                            aria-hidden="true"
                            className="size-4 shrink-0 text-muted-foreground"
                            strokeWidth={1.75}
                          />
                          <span className="min-w-0 flex-1 truncate font-normal">
                            {label}
                          </span>
                          <ArrowRight01Icon
                            aria-hidden="true"
                            className="size-4 shrink-0 text-muted-foreground"
                            strokeWidth={1.75}
                          />
                        </Link>
                      ))}
                    </nav>
                  </CardContent>
                </Card>
              </section>,
            ]
          : []
      )}
      {isLoading && (
        <p className="mt-4 text-muted-foreground text-sm" role="status">
          Loading plugins…
        </p>
      )}
      {error && (
        <p className="mt-4 text-muted-foreground text-sm" role="status">
          Couldn’t load plugins.
        </p>
      )}
    </div>
  );
}

export function SkillsPage() {
  const { activeOrg } = useAuth();
  const orgId = activeOrg?.id;
  const [search, setSearch] = useState("");

  const {
    data: skills = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    enabled: Boolean(orgId),
    queryFn: async () => (await client.listSkills(orgId)).skills,
    queryKey: [...queryKeys.skills.all, "organization", orgId],
  });

  const query = search.trim().toLowerCase();

  const {
    data: profiles,
    error: profilesError,
    refetch: refetchProfiles,
  } = useQuery({
    enabled: Boolean(orgId),
    queryFn: async () => {
      const { profiles: summaries } = await client.listProfiles(orgId);

      return Promise.all(
        summaries.map(
          async (profile) =>
            (await client.getProfile(profile.id, orgId)).profile
        )
      );
    },
    queryKey: [...queryKeys.profiles.all, "skill-assignments", orgId],
  });

  const profilesBySkill = new Map<string, ProfileSummary[]>();

  for (const profile of profiles ?? []) {
    for (const skill of profile.skills) {
      const assigned = profilesBySkill.get(skill.id) ?? [];
      assigned.push(profile);
      profilesBySkill.set(skill.id, assigned);
    }
  }

  const filtered = skills
    .filter(
      (skill) =>
        Boolean(orgId) && (skill.orgId === null || skill.orgId === orgId)
    )
    .filter((skill) =>
      `${skill.name} ${skill.description} ${skillSourceLabel(skill)}`
        .toLowerCase()
        .includes(query)
    )
    .sort(
      (left, right) =>
        (skillSourceOrder.get(skillSourceLabel(left)) ?? 3) -
          (skillSourceOrder.get(skillSourceLabel(right)) ?? 3) ||
        left.name.localeCompare(right.name)
    );

  const skillsBySource = Map.groupBy(filtered, skillSourceLabel);

  return (
    <div className="mx-auto min-w-0 max-w-4xl space-y-10">
      <IntegrationsTabs>
        <div className="relative w-full">
          <Search01Icon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="Search skills"
            className="pl-9"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search skills"
            type="search"
            value={search}
          />
        </div>
      </IntegrationsTabs>
      {isLoading && <p role="status">Loading skills…</p>}
      {error && (
        <div className="space-y-2" role="alert">
          <p className="text-destructive text-sm">{formatError(error)}</p>
          <Button onClick={() => void refetch()} variant="outline">
            Retry
          </Button>
        </div>
      )}
      {!(isLoading || error) && filtered.length === 0 && (
        <p className="text-muted-foreground text-sm" role="status">
          {query ? "No matching skills." : "No skills available."}
        </p>
      )}
      {[...skillsBySource].map(([source, sourceSkills]) => (
        <section className="space-y-3" key={source}>
          <h2 className="font-medium text-base">{source}</h2>
          <ul className="min-w-0">
            {sourceSkills.map((skill) => (
              <SkillRow key={skill.id} skill={skill}>
                <SkillProfiles
                  assigned={profilesBySkill.get(skill.id)}
                  error={Boolean(profilesError)}
                  loaded={Boolean(profiles)}
                  onRetry={() => void refetchProfiles()}
                />
              </SkillRow>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function SkillRow({
  children,
  skill,
}: {
  children: ReactNode;
  skill: SkillSummary;
}) {
  return (
    <li className="relative flex min-w-0 flex-wrap items-center gap-3 py-3.5 after:absolute after:right-0 after:bottom-0 after:left-13 after:border-border after:border-b last:after:hidden">
      <div className="relative flex min-w-0 flex-1 items-center gap-3">
        <Link
          aria-label={`View details for ${skill.name}`}
          className="absolute inset-0 rounded-md hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring"
          to={`${skillDetailPath(skill.id)}?from=skills`}
        />
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-foreground">
          <BrainIcon aria-hidden className="size-5" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="break-words font-medium text-sm">
            {skill.name}
            {!skill.enabled && (
              <span className="ml-2 font-normal text-muted-foreground text-xs">
                Disabled
              </span>
            )}
          </h3>
          <p className="mt-0.5 line-clamp-1 break-words pr-6 text-muted-foreground text-sm">
            {skill.description}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center text-xs">{children}</div>
    </li>
  );
}

function SkillProfiles({
  assigned,
  error,
  loaded,
  onRetry,
}: {
  assigned: ProfileSummary[] | undefined;
  error: boolean;
  loaded: boolean;
  onRetry(): void;
}) {
  if (error) {
    return (
      <button
        className="text-destructive underline"
        onClick={onRetry}
        type="button"
      >
        Couldn’t load profile assignments. Retry
      </button>
    );
  }

  if (!loaded) {
    return (
      <span className="text-muted-foreground" role="status">
        Loading profile assignments…
      </span>
    );
  }

  if (!assigned) {
    return (
      <span className="text-muted-foreground">Not assigned to any profile</span>
    );
  }

  return (
    <div className="flex -space-x-2">
      {assigned.map((profile) => (
        <Link
          aria-label={`Open ${profile.name}`}
          className="relative rounded-full ring-2 ring-background hover:z-10 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-ring"
          key={profile.id}
          title={profile.name}
          to={profilePath(profile.id)}
        >
          <ProfileAvatar profile={profile} size="xxs" />
        </Link>
      ))}
    </div>
  );
}
