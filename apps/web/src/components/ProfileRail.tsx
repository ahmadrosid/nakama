import type { AcpAgentPresetSummary, ToolSummary } from "@nakama/core/contract";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nakama/ui/tooltip";
import { cn } from "@nakama/ui/utils";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ProfileAdminPlusButton } from "@/components/ProfileAdminPlusButton";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { ProfileCreateDialog } from "@/components/ProfileCreateDialog";
import { SidebarNotifications } from "@/components/SidebarNotifications";
import { SidebarUserMenu } from "@/components/SidebarUserMenu";
import { useActiveChatProfile } from "@/context/use-active-chat-profile";
import { useAuth } from "@/context/use-auth";
import { useTheme } from "@/context/use-theme";
import { useSelectProfile } from "@/hooks/use-select-profile";
import { PAGE_PATHS, pathForPage, profilePath } from "@/lib/navigation";
import { markLogoSrc } from "@/lib/theme";

// Members create plain agents; tools and host-run agents stay with admins.
const NO_PRESETS: AcpAgentPresetSummary[] = [];

const NO_TOOLS: ToolSummary[] = [];

export function ProfileRail({ onNavigate }: { onNavigate?: () => void } = {}) {
  const { activeProfileId, onProfilesPage, profiles, selectProfile } =
    useSelectProfile();

  const { user, activeOrg } = useAuth();
  const { resolvedTheme } = useTheme();
  const { syncForOrg } = useActiveChatProfile();
  const navigate = useNavigate();
  const location = useLocation();
  const [createOpen, setCreateOpen] = useState(false);

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

  return (
    <div
      aria-label="Profiles"
      className="flex h-full w-14 shrink-0 flex-col items-center gap-2 border-border/50 border-r bg-sidebar/60 py-3"
    >
      <a
        aria-label="Nakama"
        className="flex size-9 shrink-0 items-center justify-center rounded-xl transition-opacity hover:opacity-80"
        href="/chat"
        title="Nakama"
      >
        <img alt="" className="size-7 object-contain" src={logoSrc} />
      </a>

      <div className="no-scrollbar flex min-h-0 flex-1 flex-col items-center gap-1.5 overflow-y-auto px-1 py-1">
        {orderedProfiles.map((profile) => {
          const active = profile.id === activeProfileId;

          const trigger = (
            <button
              aria-current={active ? "true" : undefined}
              aria-label={profile.name}
              className={cn(
                "group relative flex size-7 shrink-0 items-center justify-center rounded-md transition-all duration-150",
                active
                  ? "ring-1 ring-foreground/20 ring-offset-2 ring-offset-sidebar"
                  : "hover:bg-muted/40"
              )}
              onClick={() => handleSelectProfile(profile.id)}
              title={profile.name}
              type="button"
            >
              <ProfileAvatar
                active={
                  active &&
                  (location.pathname === PAGE_PATHS.chat ||
                    location.pathname.startsWith(`${PAGE_PATHS.chat}/`))
                }
                className={cn(
                  "size-7 rounded-md transition-all duration-150",
                  active
                    ? "opacity-100 saturate-100"
                    : "opacity-45 grayscale group-hover:opacity-70 group-hover:grayscale-0"
                )}
                profile={profile}
                size="sm"
              />
            </button>
          );

          return (
            <Tooltip key={profile.id}>
              <TooltipTrigger render={trigger} />
              <TooltipContent side="right" sideOffset={8}>
                {profile.name}
              </TooltipContent>
            </Tooltip>
          );
        })}

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
    </div>
  );
}
