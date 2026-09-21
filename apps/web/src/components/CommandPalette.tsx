import uFuzzy from "@leeoniya/ufuzzy";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@nakama/ui/command";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/use-auth";
import { useOrgPlugins } from "@/hooks/use-plugins";
import {
  enabledPluginNavEntries,
  navHrefForPage,
  STANDALONE_PAGES,
  visibleNavGroups,
} from "@/lib/navigation";

const paletteSearch = new uFuzzy({
  compare: () => 0,
  intraIns: Number.POSITIVE_INFINITY,
});

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

/**
 * Cmd+K jumps to any page the sidebar would offer this user. The destination
 * list comes from visibleNavGroups, the same gate the sidebar uses, so the
 * palette cannot route someone to a page their role hides.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const { user, activeOrg } = useAuth();
  const { data: orgPlugins = [] } = useOrgPlugins();
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

  return (
    <CommandDialog
      className="sm:max-w-2xl"
      description="Jump to a page"
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
          placeholder="Jump to a page..."
        />
        <CommandList>
          <CommandEmpty>No matching page.</CommandEmpty>
          {filteredGroups.map((group) => (
            <CommandGroup heading={group.label} key={group.id}>
              {group.items.map((item) => (
                <CommandItem
                  className="[&>svg:last-child]:hidden"
                  key={item.id}
                  onSelect={() => go(navHrefForPage(item.id))}
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
          {filteredPlugins.length > 0 ? (
            <CommandGroup heading="Plugins">
              {filteredPlugins.map((entry) => (
                <CommandItem
                  className="[&>svg:last-child]:hidden"
                  key={entry.pluginId}
                  onSelect={() => go(entry.href)}
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
          {filteredStandalone.length > 0 ? (
            <CommandGroup heading="More">
              {filteredStandalone.map((item) => (
                <CommandItem
                  className="[&>svg:last-child]:hidden"
                  key={item.id}
                  onSelect={() => go(navHrefForPage(item.id))}
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
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
