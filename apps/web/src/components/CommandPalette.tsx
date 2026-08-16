import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useAuth } from "@/context/use-auth";
import {
  navHrefForPage,
  STANDALONE_PAGES,
  visibleNavGroups,
} from "@/lib/navigation";

/**
 * Cmd+K jumps to any page the sidebar would offer this user. The destination
 * list comes from visibleNavGroups, the same gate the sidebar uses, so the
 * palette cannot route someone to a page their role hides.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { user, activeOrg } = useAuth();

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
      navigate(href);
    },
    [navigate]
  );

  return (
    <CommandDialog
      description="Jump to a page"
      onOpenChange={setOpen}
      open={open}
      title="Command palette"
    >
      {/* CommandDialog drops children straight into DialogContent, so the cmdk
          root has to come from here or none of the parts get their context. */}
      <Command>
        <CommandInput placeholder="Jump to a page..." />
        <CommandList>
          <CommandEmpty>No matching page.</CommandEmpty>
          {groups.map((group) => (
            <CommandGroup heading={group.label} key={group.id}>
              {group.items.map((item) => (
                <CommandItem
                  key={item.id}
                  onSelect={() => go(navHrefForPage(item.id))}
                  value={`${item.label} ${item.description}`}
                >
                  <item.icon className="size-4" />
                  <span>{item.label}</span>
                  <span className="ml-auto truncate text-muted-foreground text-xs">
                    {item.description}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
          {standalone.length > 0 ? (
            <CommandGroup heading="More">
              {standalone.map((item) => (
                <CommandItem
                  key={item.id}
                  onSelect={() => go(navHrefForPage(item.id))}
                  value={`${item.label} ${item.description}`}
                >
                  <item.icon className="size-4" />
                  <span>{item.label}</span>
                  <span className="ml-auto truncate text-muted-foreground text-xs">
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
