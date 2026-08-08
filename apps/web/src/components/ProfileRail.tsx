import { useLocation, useNavigate } from "react-router-dom";
import { ProfileAdminPlusButton } from "@/components/ProfileAdminPlusButton";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { SidebarNotifications } from "@/components/SidebarNotifications";
import { SidebarUserMenu } from "@/components/SidebarUserMenu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useActiveChatProfile } from "@/context/use-active-chat-profile";
import { useAuth } from "@/context/use-auth";
import { useTheme } from "@/context/use-theme";
import { useProfilesQuery } from "@/hooks/use-app-queries";
import {
  buildChatBasePath,
  isChatSessionPath,
  resolveActiveProfileIdFromLocation,
} from "@/lib/chat-history";
import { PAGE_PATHS, pathForPage } from "@/lib/navigation";
import { ditherLogoSrc } from "@/lib/theme";
import { cn } from "@/lib/utils";

export function ProfileRail() {
  const { data: profiles = [] } = useProfilesQuery();
  const { user } = useAuth();
  const { resolvedTheme } = useTheme();
  const {
    profileId: liveChatProfileId,
    setProfileId: setLiveChatProfileId,
    switchChatProfile,
  } = useActiveChatProfile();
  const navigate = useNavigate();
  const location = useLocation();

  const logoSrc = ditherLogoSrc(resolvedTheme);

  const activeProfileId = resolveActiveProfileIdFromLocation({
    historyPath: PAGE_PATHS.history,
    liveChatProfileId,
    pathname: location.pathname,
    profiles,
    search: location.search,
  });

  function handleSelectProfile(profileId: string) {
    if (profileId === activeProfileId) {
      return;
    }

    if (location.pathname === PAGE_PATHS.history) {
      setLiveChatProfileId(profileId);
      const params = new URLSearchParams(location.search);
      params.set("profile", profileId);
      navigate(`${PAGE_PATHS.history}?${params.toString()}`);
      return;
    }

    // Draft /chat: reset in place via the mounted ChatPage handler.
    if (location.pathname === buildChatBasePath()) {
      switchChatProfile(profileId);
      return;
    }

    setLiveChatProfileId(profileId);
    navigate(buildChatBasePath(), {
      replace: isChatSessionPath(location.pathname),
    });
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
        <img
          alt=""
          className="size-8 rounded-lg object-contain"
          src={logoSrc}
        />
      </a>

      <div className="no-scrollbar flex min-h-0 flex-1 flex-col items-center gap-1.5 overflow-y-auto px-1 py-1">
        {profiles.map((profile) => {
          const active = profile.id === activeProfileId;
          const trigger = (
            <button
              aria-current={active ? "true" : undefined}
              aria-label={profile.name}
              className={cn(
                "group relative flex size-7 shrink-0 items-center justify-center rounded-md transition-all duration-150",
                active
                  ? "bg-background shadow-sm ring-2 ring-primary ring-offset-1 ring-offset-sidebar/60"
                  : "hover:bg-muted/40"
              )}
              onClick={() => handleSelectProfile(profile.id)}
              title={profile.name}
              type="button"
            >
              <ProfileAvatar
                active={active}
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
            label="Manage profiles"
            onClick={() => navigate(pathForPage("profiles"))}
          />
        ) : null}
      </div>

      <div className="flex shrink-0 flex-col items-center gap-1">
        <SidebarNotifications />
        <SidebarUserMenu />
      </div>
    </div>
  );
}
