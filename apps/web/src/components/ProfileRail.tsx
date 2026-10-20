import { ContextMenu } from "@base-ui/react/context-menu";
import type { ProfileSummary } from "@nakama/core";
import type { AgentGroup } from "@nakama/core/agent-groups";
import type { AcpAgentPresetSummary, ToolSummary } from "@nakama/core/contract";
import { ConfirmDialog } from "@nakama/ui/dialog";
import { DropdownMenuItem } from "@nakama/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nakama/ui/tooltip";
import { cn } from "@nakama/ui/utils";
import {
  Delete02Icon,
  PencilEdit02Icon,
  PinIcon,
  PinOffIcon,
  PlusSignSquareIcon,
} from "hugeicons-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { GroupAvatar } from "@/components/agent-groups/GroupAvatar";
import { GroupDialog } from "@/components/agent-groups/group-dialog";
import { ProfileAdminPlusButton } from "@/components/ProfileAdminPlusButton";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { ProfileCreateDialog } from "@/components/ProfileCreateDialog";
import { SidebarNotifications } from "@/components/SidebarNotifications";
import { SidebarUserMenu } from "@/components/SidebarUserMenu";
import { useActiveChatProfile } from "@/context/use-active-chat-profile";
import { useAuth } from "@/context/use-auth";
import { useTheme } from "@/context/use-theme";
import {
  useAgentGroupsQuery,
  useDeleteGroup,
  useRailPinsQuery,
  useToggleRailPin,
} from "@/hooks/use-agent-groups";
import { useSelectProfile } from "@/hooks/use-select-profile";
import {
  groupPath,
  groupRouteFromPath,
  PAGE_PATHS,
  pathForPage,
  profilePath,
} from "@/lib/navigation";
import { markLogoSrc } from "@/lib/theme";

// Members create plain agents; tools and host-run agents stay with admins.
const NO_PRESETS: AcpAgentPresetSummary[] = [];

const NO_TOOLS: ToolSummary[] = [];

type RailItem =
  | { id: string; kind: "agent"; profile: ProfileSummary }
  | { id: string; kind: "group"; group: AgentGroup };

function RailDivider() {
  return (
    <div aria-hidden="true" className="my-0.5 h-px w-5 shrink-0 bg-border" />
  );
}

export function ProfileRail({ onNavigate }: { onNavigate?: () => void } = {}) {
  const { activeProfileId, onProfilesPage, profiles, selectProfile } =
    useSelectProfile();

  const { user, activeOrg } = useAuth();
  const { resolvedTheme } = useTheme();
  const { syncForOrg } = useActiveChatProfile();
  const navigate = useNavigate();
  const location = useLocation();
  const [createOpen, setCreateOpen] = useState(false);
  const { data: groups = [] } = useAgentGroupsQuery();
  const { data: pins = [] } = useRailPinsQuery();
  const togglePin = useToggleRailPin();
  // A long press opens the pin menu, and lifting the finger then fires a
  // click; for a moment that click neither navigates nor closes the menu.
  const menuOpenedAt = useRef(0);
  const [menuItemId, setMenuItemId] = useState<string | null>(null);
  const [editingGroup, setEditingGroup] = useState<AgentGroup | null>(null);
  const [deletingGroup, setDeletingGroup] = useState<AgentGroup | null>(null);
  const deleteGroup = useDeleteGroup();
  const openGroupId = groupRouteFromPath(location.pathname)?.groupId ?? null;

  useEffect(() => {
    if (profiles.length === 0) {
      return;
    }

    syncForOrg({ orgId: activeOrg?.id ?? null, profiles });
  }, [activeOrg?.id, profiles, syncForOrg]);

  const logoSrc = markLogoSrc(resolvedTheme);

  const orderedProfiles = profiles.toSorted(
    (left, right) => Number(right.isSuper) - Number(left.isSuper)
  );

  function handleSelectProfile(profileId: string) {
    onNavigate?.();
    selectProfile(profileId);
  }

  /** Same rule as the server: admins edit any agent, members their own. */
  function canEditAgent(profile: ProfileSummary): boolean {
    return (
      user?.isPlatformAdmin === true ||
      activeOrg?.role === "admin" ||
      (!profile.isSuper && profile.ownerUserId === user?.id)
    );
  }

  function openGroup(groupId: string) {
    onNavigate?.();
    navigate(groupPath(groupId));
  }

  const allItems: RailItem[] = [
    ...orderedProfiles.map((profile) => ({
      id: profile.id,
      kind: "agent" as const,
      profile,
    })),
    ...groups.map((group) => ({ group, id: group.id, kind: "group" as const })),
  ];

  // Pinned agents and groups lead the rail, latest pin first.
  const pinnedItems = pins.flatMap(
    (id) => allItems.find((item) => item.id === id) ?? []
  );

  const agentItems = allItems.filter(
    (item) => item.kind === "agent" && !pins.includes(item.id)
  );

  const groupItems = allItems.filter(
    (item) => item.kind === "group" && !pins.includes(item.id)
  );

  function renderItem(item: RailItem) {
    const name = item.kind === "agent" ? item.profile.name : item.group.name;
    const pinned = pins.includes(item.id);

    // An open group takes the highlight from the chat agent.
    const active =
      item.kind === "agent"
        ? !openGroupId && item.id === activeProfileId
        : item.id === openGroupId;

    const avatarClass = cn(
      "size-7 rounded-md outline-none transition-all duration-150",
      active
        ? "opacity-100 saturate-100"
        : "opacity-45 grayscale group-hover:opacity-70 group-hover:grayscale-0"
    );

    const trigger = (
      <button
        aria-current={active ? "true" : undefined}
        aria-label={name}
        className={cn(
          "group relative flex size-7 shrink-0 items-center justify-center rounded-md transition-all duration-150",
          !active && "hover:bg-muted/40"
        )}
        onClick={() => {
          if (Date.now() - menuOpenedAt.current < 700) {
            return;
          }

          if (item.kind === "agent") {
            handleSelectProfile(item.id);

            return;
          }

          // Like an agent: picking the open group keeps its current chat.
          if (item.id !== openGroupId) {
            openGroup(item.id);
          }
        }}
        title={name}
        type="button"
      >
        {item.kind === "agent" ? (
          <ProfileAvatar
            active={
              active &&
              (location.pathname === PAGE_PATHS.chat ||
                location.pathname.startsWith(`${PAGE_PATHS.chat}/`))
            }
            className={avatarClass}
            profile={item.profile}
            size="sm"
          />
        ) : (
          <GroupAvatar
            className={avatarClass}
            group={item.group}
            profiles={profiles}
          />
        )}
      </button>
    );

    // Right-click, or a long press on touch, opens the item's menu.
    return (
      <ContextMenu.Root
        key={item.id}
        onOpenChange={(open) => {
          if (open) {
            menuOpenedAt.current = Date.now();
            setMenuItemId(item.id);
          } else if (Date.now() - menuOpenedAt.current > 700) {
            setMenuItemId(null);
          }
        }}
        open={menuItemId === item.id}
      >
        <ContextMenu.Trigger className="flex shrink-0">
          <Tooltip>
            <TooltipTrigger render={trigger} />
            <TooltipContent side="right" sideOffset={8}>
              {name}
            </TooltipContent>
          </Tooltip>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Positioner className="isolate z-50 outline-none">
            <ContextMenu.Popup className="z-50 min-w-36 rounded-lg bg-popover p-1 text-popover-foreground shadow-md outline-none ring-1 ring-foreground/10">
              <DropdownMenuItem
                onClick={() => togglePin({ itemId: item.id, pinned: !pinned })}
              >
                {pinned ? <PinOffIcon /> : <PinIcon />}
                {pinned ? "Unpin" : "Pin to top"}
              </DropdownMenuItem>
              {item.kind === "group" ? (
                <>
                  <DropdownMenuItem onClick={() => openGroup(item.id)}>
                    <PlusSignSquareIcon />
                    New chat
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setEditingGroup(item.group)}>
                    <PencilEdit02Icon />
                    Edit group
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setDeletingGroup(item.group)}
                    variant="destructive"
                  >
                    <Delete02Icon />
                    Delete group
                  </DropdownMenuItem>
                </>
              ) : canEditAgent(item.profile) ? (
                <DropdownMenuItem
                  onClick={() => {
                    onNavigate?.();
                    navigate(profilePath(item.id));
                  }}
                >
                  <PencilEdit02Icon />
                  Edit agent
                </DropdownMenuItem>
              ) : null}
            </ContextMenu.Popup>
          </ContextMenu.Positioner>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    );
  }

  return (
    <div
      aria-label="Profiles"
      className="flex h-full w-14 shrink-0 flex-col items-center gap-2 border-border/50 border-r bg-sidebar/60 py-3"
    >
      <a
        aria-label="Nakama"
        className="flex size-7 shrink-0 items-center justify-center rounded-md transition-opacity hover:opacity-80"
        href="/chat"
        title="Nakama"
      >
        <img
          alt=""
          className="size-5.5 -translate-y-px object-contain"
          src={logoSrc}
        />
      </a>

      <div className="no-scrollbar flex min-h-0 flex-1 flex-col items-center gap-1.5 overflow-y-auto px-1 py-1">
        {pinnedItems.map(renderItem)}
        {pinnedItems.length > 0 && agentItems.length + groupItems.length > 0 ? (
          <RailDivider />
        ) : null}
        {agentItems.map(renderItem)}
        {groupItems.length > 0 && agentItems.length > 0 ? (
          <RailDivider />
        ) : null}
        {groupItems.map(renderItem)}

        {user?.isPlatformAdmin ? (
          <ProfileAdminPlusButton
            label={onProfilesPage ? "New profile" : "Manage profiles"}
            onClick={() => {
              onNavigate?.();

              if (!onProfilesPage) {
                navigate(pathForPage("profiles"));

                return;
              }

              if (location.pathname !== PAGE_PATHS.profiles) {
                navigate(`${PAGE_PATHS.profiles}?create=1`);

                return;
              }

              const params = new URLSearchParams(location.search);
              params.set("create", "1");
              navigate(`${PAGE_PATHS.profiles}?${params.toString()}`);
            }}
          />
        ) : (
          <ProfileAdminPlusButton
            label="New agent"
            onClick={() => setCreateOpen(true)}
          />
        )}
      </div>

      {user?.isPlatformAdmin ? null : (
        <ProfileCreateDialog
          agentPresets={NO_PRESETS}
          onCreated={(profileId) => {
            onNavigate?.();
            navigate(profilePath(profileId));
          }}
          onOpenChange={setCreateOpen}
          open={createOpen}
          tools={NO_TOOLS}
        />
      )}

      <div className="flex shrink-0 flex-col items-center gap-1">
        <SidebarNotifications />
        <SidebarUserMenu />
      </div>

      {editingGroup ? (
        <GroupDialog
          group={editingGroup}
          onClose={() => setEditingGroup(null)}
        />
      ) : null}
      {deletingGroup ? (
        <ConfirmDialog
          description={`Delete "${deletingGroup.name}" with all its chats? This cannot be undone.`}
          onClose={() => setDeletingGroup(null)}
          onConfirm={async () => {
            await deleteGroup.mutateAsync(deletingGroup.id);

            if (openGroupId === deletingGroup.id) {
              navigate(PAGE_PATHS.groups);
            }
          }}
          title="Delete group?"
        />
      ) : null}
    </div>
  );
}
