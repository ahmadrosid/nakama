import type { ProfileSummary } from "@nakama/core/contract";
import { cn } from "@nakama/ui/utils";
import { ChatProfileSwitcher } from "@/components/chat/chat-profile-switcher";
import { useChatAttachmentPanel } from "@/context/use-chat-attachment-panel";

export function ChatPageColumn({
  children,
  centered = false,
}: {
  children: React.ReactNode;
  centered?: boolean;
}) {
  const attachmentPanel = useChatAttachmentPanel();

  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-col transition-[width,opacity,padding] duration-200 ease-out motion-reduce:transition-none",
        attachmentPanel.isFullscreen
          ? "pointer-events-none w-0 flex-none overflow-hidden px-0 opacity-0"
          : "flex-1 px-3 sm:px-6",
        // No room for two columns on a phone, so an open panel takes over.
        attachmentPanel.isOpen &&
          "max-sm:pointer-events-none max-sm:w-0 max-sm:flex-none max-sm:overflow-hidden max-sm:px-0 max-sm:opacity-0",
        centered && "justify-center"
      )}
    >
      {children}
    </div>
  );
}

export function ChatWelcome({
  profile,
  profileId,
  profiles,
  onProfileSwitch,
  profileSwitchDisabled = false,
}: {
  profile: ProfileSummary | undefined;
  profileId: string;
  profiles: ProfileSummary[];
  onProfileSwitch: (profileId: string) => void;
  profileSwitchDisabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 px-4 pb-2">
      <h2 className="type-section-title text-xl tracking-tight">
        Hi, good{" "}
        {new Date().getHours() < 12
          ? "morning"
          : new Date().getHours() < 18
            ? "afternoon"
            : "evening"}
        !
      </h2>
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
