import {
  buildChatBasePath,
  isChatSessionPath,
  isProfilesPath,
} from "@/lib/chat-history";
import { PAGE_PATHS, profilePath } from "@/lib/navigation";

/** What picking an agent does; "select" and "navigate" both make it live. */
export type ProfileSwitch =
  | { kind: "stay" }
  | { kind: "select" }
  | { kind: "navigate"; replace: boolean; to: string };

/**
 * Picking an agent is page-aware: Profiles, Files, Automations and the draft
 * chat swap the agent in place, every other page opens a fresh chat with it.
 */
export function resolveProfileSwitch(input: {
  activeProfileId: string | null;
  pathname: string;
  profileId: string;
  search: string;
}): ProfileSwitch {
  const { activeProfileId, pathname, profileId, search } = input;
  const onProfilesPage = isProfilesPath(pathname, PAGE_PATHS.profiles);
  // Draft /chat included: ChatPage enters a new draft for the live id itself.
  const swapsInPlace =
    pathname === PAGE_PATHS.files ||
    pathname === PAGE_PATHS.automations ||
    pathname === buildChatBasePath();

  if (profileId === activeProfileId) {
    return { kind: "stay" };
  }

  if (onProfilesPage) {
    if (pathname !== PAGE_PATHS.profiles) {
      return { kind: "navigate", replace: false, to: profilePath(profileId) };
    }
    const params = new URLSearchParams(search);
    params.set("profile", profileId);
    return {
      kind: "navigate",
      replace: true,
      to: `${PAGE_PATHS.profiles}?${params.toString()}`,
    };
  }

  if (swapsInPlace) {
    return { kind: "select" };
  }

  return {
    kind: "navigate",
    replace: isChatSessionPath(pathname),
    to: buildChatBasePath(),
  };
}
