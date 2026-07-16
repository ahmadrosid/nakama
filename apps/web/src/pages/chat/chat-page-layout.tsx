import type { ProfileSummary } from "@nakama/core/contract";
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

export function ChatWelcome({ profile }: { profile: ProfileSummary | undefined }) {
  return (
    <div className="flex items-center gap-4 px-2">
      <div className="min-w-0 text-left">
        <h2 className="type-section-title text-xl tracking-tight">
          Hi, good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}!
        </h2>
        <p className="type-body mt-1 max-w-sm">
          {profile?.isSuper
            ? "Ask anything, attach images, or run tools."
            : "What can I help you with today?"}
        </p>
      </div>
    </div>
  );
}
