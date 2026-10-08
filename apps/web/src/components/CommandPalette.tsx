import uFuzzy from "@leeoniya/ufuzzy";
import type { ProfileSummary } from "@nakama/core/contract";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@nakama/ui/command";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { useActiveChatProfile } from "@/context/use-active-chat-profile";
import { useAuth } from "@/context/use-auth";
import { useOrgPlugins } from "@/hooks/use-plugins";
import { useSelectProfile } from "@/hooks/use-select-profile";
import { buildNewChatPath } from "@/lib/chat-history";
import { client } from "@/lib/client";
import {
  enabledPluginNavEntries,
  type NavGroup,
  type NavItem,
  navHrefForPage,
  STANDALONE_PAGES,
  visibleNavGroups,
} from "@/lib/navigation";

const paletteSearch = new uFuzzy({
  compare: () => 0,
  intraIns: Number.POSITIVE_INFINITY,
});

interface AgentResult {
  orgId: string;
  orgName: string;
  profile: ProfileSummary;
}

async function searchPlatformAgents(
  orgs: { id: string; name: string }[],
  activeOrgId: string | undefined
) {
  const items: AgentResult[] = [];
  let error = false;

  for (let i = 0; i < orgs.length; i += 4) {
    const batch = orgs.slice(i, i + 4);

    const results = await Promise.allSettled(
      batch.map((org) => client.listProfiles(org.id))
    );

    results.forEach((result, index) => {
      const org = batch[index];

      if (result.status === "fulfilled" && org) {
        items.push(
          ...result.value.profiles
            .filter(
              (profile) =>
                !(
                  profile.isSuper ||
                  (profile.isDefault && profile.name === "Default Bot")
                ) || org.id === activeOrgId
            )
            .map((profile) => ({ orgId: org.id, orgName: org.name, profile }))
        );
      } else {
        error = true;
      }
    });
  }

  return { error, items };
}

function fuzzyFilter<T>(
  items: T[],
  query: string,
  getText: (item: T) => string
) {
  const needle = query.trim().toLowerCase();

  if (!needle) {
    return items;
  }

  const [indices, info, order] = paletteSearch.search(
    items.map((item) => getText(item)),
    needle
  );

  const matches =
    info && order ? order.map((index) => info.idx[index]) : indices;

  return (matches ?? []).map((index) => items[index]);
}

function NavigationResults({
  groups,
  plugins,
  standalone,
  onNavigate,
}: {
  groups: NavGroup[];
  plugins: ReturnType<typeof enabledPluginNavEntries>;
  standalone: NavItem[];
  onNavigate: (href: string) => void;
}) {
  return (
    <>
      {groups.map((group) => (
        <CommandGroup heading={group.label} key={group.id}>
          {group.items.map((item) => (
            <CommandItem
              className="[&>svg:last-child]:hidden"
              key={item.id}
              onSelect={() => onNavigate(navHrefForPage(item.id))}
              value={`${item.label} ${item.description}`}
            >
              <item.icon className="size-4" />
              <span>{item.label}</span>
              <span className="ml-auto min-w-0 flex-1 truncate text-right text-muted-foreground text-xs">
                {item.description}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      ))}
      {plugins.length > 0 ? (
        <CommandGroup heading="Plugins">
          {plugins.map((entry) => (
            <CommandItem
              className="[&>svg:last-child]:hidden"
              key={entry.pluginId}
              onSelect={() => onNavigate(entry.href)}
              value={`${entry.label} ${entry.pluginId}`}
            >
              <span>{entry.label}</span>
              <span className="ml-auto min-w-0 flex-1 truncate text-right text-muted-foreground text-xs">
                {entry.pluginId}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      ) : null}
      {standalone.length > 0 ? (
        <CommandGroup heading="More">
          {standalone.map((item) => (
            <CommandItem
              className="[&>svg:last-child]:hidden"
              key={item.id}
              onSelect={() => onNavigate(navHrefForPage(item.id))}
              value={`${item.label} ${item.description}`}
            >
              <item.icon className="size-4" />
              <span>{item.label}</span>
              <span className="ml-auto min-w-0 flex-1 truncate text-right text-muted-foreground text-xs">
                {item.description}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      ) : null}
    </>
  );
}

function AgentResults({
  activeOrgId,
  items,
  isPlatformAdmin,
  onSelect,
  selectionError,
}: {
  activeOrgId: string | undefined;
  items: AgentResult[];
  isPlatformAdmin: boolean;
  onSelect: (item: AgentResult) => void;
  selectionError: string | null;
}) {
  return (
    <>
      {items.length > 0 ? (
        <CommandGroup heading="Agents">
          {items.map((item) => (
            <CommandItem
              className="[&>svg:last-child]:hidden"
              key={`${item.orgId}:${item.profile.id}`}
              onSelect={() => onSelect(item)}
              value={`agent ${item.orgId} ${item.profile.id}`}
            >
              <ProfileAvatar
                className="rounded-md"
                orgId={item.orgId === activeOrgId ? undefined : item.orgId}
                profile={item.profile}
                size="xs"
              />
              <span className="truncate">{item.profile.name}</span>
              <span className="ml-auto min-w-0 flex-1 truncate text-right text-muted-foreground text-xs">
                {isPlatformAdmin ? item.orgName : item.profile.model}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      ) : null}
      {selectionError ? (
        <CommandGroup heading="Agents">
          <CommandItem disabled>{selectionError}</CommandItem>
        </CommandGroup>
      ) : null}
    </>
  );
}

/**
 * Cmd+K jumps to any page the sidebar would offer this user, or straight to
 * one of their agents. The destination list comes from visibleNavGroups, the
 * same gate the sidebar uses, so the palette cannot route someone to a page
 * their role hides.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const switchingRef = useRef(false);
  const navigate = useNavigate();

  const {
    user,
    activeOrg,
    platformOrgs,
    platformOrgsError,
    refreshPlatformOrgs,
    switchOrg,
  } = useAuth();

  const { data: orgPlugins = [] } = useOrgPlugins();
  const { profiles, selectProfile } = useSelectProfile();
  const { syncForOrg } = useActiveChatProfile();
  const isPlatformAdmin = user?.isPlatformAdmin === true;

  const activePlatformOrgs = useMemo(
    () => platformOrgs.filter((org) => !org.archivedAt),
    [platformOrgs]
  );

  const search = useQuery({
    enabled: open && isPlatformAdmin && !platformOrgsError,
    queryFn: () => searchPlatformAgents(activePlatformOrgs, activeOrg?.id),
    queryKey: [
      "platform-agent-search",
      user?.id,
      activeOrg?.id,
      activePlatformOrgs.map((org) => [org.id, org.name]),
    ],
    staleTime: 30_000,
  });

  const agentResults = isPlatformAdmin
    ? (search.data?.items ?? [])
    : profiles.map((profile) => ({
        orgId: activeOrg?.id ?? "",
        orgName: activeOrg?.name ?? "",
        profile,
      }));

  const pluginNav = useMemo(
    () => enabledPluginNavEntries(orgPlugins),
    [orgPlugins]
  );

  const groups = useMemo(
    () =>
      visibleNavGroups({
        isPlatformAdmin: user?.isPlatformAdmin === true,
        orgRole: activeOrg?.role,
      }),
    [activeOrg?.role, user?.isPlatformAdmin]
  );

  // Reachable but deliberately absent from the sidebar, so the palette is the
  // only keyboard route to them.
  const standalone = useMemo(
    () => Object.values(STANDALONE_PAGES).filter((item) => item !== undefined),
    []
  );

  const filteredGroups = useMemo(
    () =>
      groups
        .map((group) => ({
          ...group,
          items: fuzzyFilter(group.items, query, (item) =>
            `${item.label} ${item.description}`.toLowerCase()
          ),
        }))
        .filter((group) => group.items.length > 0)
        .sort((left, right) => {
          const needle = query.trim().toLowerCase();

          const priority = (label: string) => {
            const normalized = label.toLowerCase();

            return normalized === needle
              ? 0
              : normalized.startsWith(needle)
                ? 1
                : 2;
          };

          return (
            priority(left.items[0]?.label ?? "") -
            priority(right.items[0]?.label ?? "")
          );
        }),
    [groups, query]
  );

  const filteredProfiles = fuzzyFilter(
    agentResults.toSorted(
      (left, right) =>
        Number(right.profile.isSuper) - Number(left.profile.isSuper)
    ),
    query,
    (item) => `${item.profile.name} ${item.orgName}`.toLowerCase()
  );

  const filteredPlugins = useMemo(
    () =>
      fuzzyFilter(pluginNav, query, (entry) =>
        `${entry.label} ${entry.pluginId}`.toLowerCase()
      ),
    [pluginNav, query]
  );

  const filteredStandalone = useMemo(
    () =>
      fuzzyFilter(standalone, query, (item) =>
        `${item.label} ${item.description}`.toLowerCase()
      ),
    [query, standalone]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "k" || !(event.metaKey || event.ctrlKey)) {
        return;
      }

      event.preventDefault();
      setOpen((current) => !current);
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      setQuery("");
      navigate(href);
    },
    [navigate]
  );

  async function goToProfile(item: AgentResult) {
    if (switchingRef.current) {
      return;
    }

    setSelectionError(null);

    if (item.orgId === activeOrg?.id) {
      selectProfile(item.profile.id);
    } else {
      switchingRef.current = true;

      try {
        await switchOrg(item.orgId);
        syncForOrg({
          orgId: item.orgId,
          preferredProfileId: item.profile.id,
          profiles: [item.profile],
        });
        navigate(buildNewChatPath(item.profile.id));
      } catch (error) {
        setSelectionError(
          error instanceof Error
            ? error.message
            : "Could not switch organization."
        );
        switchingRef.current = false;

        return;
      }

      switchingRef.current = false;
    }

    setOpen(false);
    setQuery("");
  }

  return (
    <CommandDialog
      className="sm:max-w-2xl"
      description="Jump to a page or agent"
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);

        if (!nextOpen) {
          setQuery("");
        }
      }}
      open={open}
      title="Command palette"
    >
      {/* CommandDialog drops children straight into DialogContent, so the cmdk
          root has to come from here or none of the parts get their context. */}
      <Command shouldFilter={false}>
        <CommandInput
          onValueChange={setQuery}
          placeholder="Jump to a page or agent..."
        />
        <CommandList>
          <CommandEmpty>
            {isPlatformAdmin && open && search.isPending
              ? "Loading agents..."
              : "No matching page or agent."}
          </CommandEmpty>
          <NavigationResults
            groups={filteredGroups}
            onNavigate={go}
            plugins={filteredPlugins}
            standalone={filteredStandalone}
          />
          {isPlatformAdmin &&
          (platformOrgsError || search.data?.error || search.isError) ? (
            <CommandGroup heading="Agents">
              <CommandItem
                onSelect={() => {
                  if (platformOrgsError) {
                    void refreshPlatformOrgs().catch(() => undefined);
                  } else {
                    void search.refetch();
                  }
                }}
              >
                Could not load all agents. Retry
              </CommandItem>
            </CommandGroup>
          ) : null}
          <AgentResults
            activeOrgId={activeOrg?.id}
            isPlatformAdmin={isPlatformAdmin}
            items={filteredProfiles}
            onSelect={(item) => void goToProfile(item)}
            selectionError={selectionError}
          />
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
