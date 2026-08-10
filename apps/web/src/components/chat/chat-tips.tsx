import { AlertCircleIcon, BulbIcon } from "hugeicons-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const TIPS = [
  "Use the Super Bot profile to create your own agents and tools.",
  "Type / to use a skill — a quick shortcut for common tasks.",
  "Switch profiles from the composer to give the agent a different personality and tools.",
];

const TIP_INTERVAL_MS = 10_000;

function ChatComposerNotice({
  children,
  className,
  role,
}: {
  children: React.ReactNode;
  className?: string;
  role?: React.AriaRole;
}) {
  return (
    <div className="px-4">
      <div
        className={cn(
          "relative overflow-hidden rounded-t-xl border-border border-x border-t bg-card/75 px-3 py-2",
          className
        )}
        role={role}
      >
        {children}
      </div>
    </div>
  );
}

export function ChatComposerError({ message }: { message: string }) {
  return (
    <ChatComposerNotice role="alert">
      <div className="flex items-start gap-2 text-muted-foreground text-xs sm:items-center">
        <AlertCircleIcon
          aria-hidden
          className="mt-0.5 size-3 shrink-0 text-destructive/80 sm:mt-0"
        />
        <div className="relative min-w-0 flex-1 sm:min-h-4">
          <span className="block text-destructive/90 leading-relaxed">
            {message}
          </span>
        </div>
      </div>
    </ChatComposerNotice>
  );
}

export function ChatTips({ className }: { className?: string }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setIndex((current) => (current + 1) % TIPS.length);
    }, TIP_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <ChatComposerNotice className={className}>
      <div className="flex items-center gap-2 text-muted-foreground text-xs">
        <BulbIcon aria-hidden className="size-3 shrink-0 text-primary/80" />
        <div className="relative min-h-4 flex-1 overflow-hidden">
          <span
            aria-live="polite"
            className="chat-tip-slide-up block truncate"
            key={index}
          >
            {TIPS[index]}
          </span>
        </div>
      </div>
    </ChatComposerNotice>
  );
}
