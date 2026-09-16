import type { ProfileSummary } from "@nakama/core/contract";
import { cn } from "@nakama/ui/utils";
import { ChatProfileSwitcher } from "@/components/chat/chat-profile-switcher";
import { useChatAttachmentPanel } from "@/context/use-chat-attachment-panel";
import { welcomeAnimationKey } from "@/pages/chat/chat-page.shared";

/**
 * Applied straight to the column rather than as an overlay child, so nothing
 * has to be lifted out of the way with z-index. The gradient is opaque, so the
 * result is identical.
 */
const COGNITO_SURFACE =
  "radial-gradient(125% 125% at 50% 100%, #000000 40%, #010133 100%)";

export function ChatPageColumn({
  children,
  centered = false,
  cognito = false,
}: {
  children: React.ReactNode;
  centered?: boolean;
  cognito?: boolean;
}) {
  const attachmentPanel = useChatAttachmentPanel();

  return (
    <div
      className={cn(
        cognito && "dark",
        // `relative` so a page-level control can pin itself to this column's
        // top-right corner, which is the top-right of the screen area.
        "relative flex min-h-0 min-w-0 flex-col transition-[width,opacity,padding] duration-200 ease-out motion-reduce:transition-none",
        attachmentPanel.isFullscreen
          ? "pointer-events-none w-0 flex-none overflow-hidden px-0 opacity-0"
          : "flex-1 px-3 sm:px-6",
        // No room for two columns on a phone, so an open panel takes over.
        attachmentPanel.isOpen &&
          "max-sm:pointer-events-none max-sm:w-0 max-sm:flex-none max-sm:overflow-hidden max-sm:px-0 max-sm:opacity-0",
        centered && "justify-center"
      )}
      // `dark` is a plain class here, not html.dark, so it re-declares the
      // colour tokens for this subtree only. Without it a light theme would
      // paint dark text onto the near-black gradient.
      style={cognito ? { background: COGNITO_SURFACE } : undefined}
    >
      {children}
    </div>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  const partOfDay = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  return `Hi, good ${partOfDay}!`;
}

/**
 * In cognito the pleasantry is the least useful thing on screen, so the slot
 * says what the mode actually does instead.
 */
function CognitoWelcome() {
  return (
    <>
      <h2 className="type-section-title text-xl tracking-tight">
        Cognito chat
      </h2>
      <p className="type-body text-muted-foreground text-sm">
        Not saved, never in History, never written to memory. Reloading the page
        ends it. It still uses memory, plugins, skills and this agent's
        instructions.
      </p>
    </>
  );
}

export function ChatWelcome({
  profile,
  profileId,
  profiles,
  onProfileSwitch,
  profileSwitchDisabled = false,
  cognito = false,
}: {
  profile: ProfileSummary | undefined;
  profileId: string;
  profiles: ProfileSummary[];
  onProfileSwitch: (profileId: string) => void;
  profileSwitchDisabled?: boolean;
  cognito?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 px-4 pb-2">
      {/*
        Keyed so React remounts the block on every switch, which replays the
        entrance animation.
      */}
      <div
        className="fade-in-0 slide-in-from-top-1 flex animate-in flex-col gap-2 duration-300 motion-reduce:animate-none"
        key={welcomeAnimationKey(cognito)}
      >
        {cognito ? (
          <CognitoWelcome />
        ) : (
          <h2 className="type-section-title text-xl tracking-tight">
            {greeting()}
          </h2>
        )}
      </div>
      <div className="flex items-center gap-2 self-start">
        <span className="type-body text-muted-foreground text-sm">
          Select profile
        </span>
        <ChatProfileSwitcher
          activeProfile={profile}
          disabled={profileSwitchDisabled}
          onProfileSwitch={onProfileSwitch}
          profileId={profileId}
          profiles={profiles}
          variant="prominent"
        />
      </div>
    </div>
  );
}
