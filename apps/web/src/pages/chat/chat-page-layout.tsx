import type { ProfileSummary } from "@nakama/core/contract";
import { ChatProfileSwitcher } from "@/components/chat/chat-profile-switcher";
import { useChatAttachmentPanel } from "@/context/use-chat-attachment-panel";
import { cn } from "@/lib/utils";

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
        "flex min-h-0 min-w-0 flex-1 flex-col px-6",
        attachmentPanel.isFullscreen && "hidden",
        centered && "justify-center",
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
    <div className="flex flex-col gap-2 px-2">
      <h2 className="type-section-title text-xl tracking-tight">
        Hi, good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}!
      </h2>
      <div className="flex items-center gap-2 self-start">
        <span className="type-body text-sm text-muted-foreground">Select profile</span>
        <ChatProfileSwitcher
          variant="prominent"
          profileId={profileId}
          profiles={profiles}
          activeProfile={profile}
          onProfileSwitch={onProfileSwitch}
          disabled={profileSwitchDisabled}
        />
      </div>
    </div>
  );
}
