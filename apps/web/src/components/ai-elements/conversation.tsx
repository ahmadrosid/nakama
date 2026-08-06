"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowDownIcon } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  type ComponentProps,
  type HTMLAttributes,
  type ReactNode,
} from "react";

export interface ConversationStickinessValue {
  isAtBottom: boolean;
  scrollToLatest: () => void;
}

const ConversationStickinessContext = createContext<ConversationStickinessValue | null>(
  null,
);

export function ConversationStickinessProvider({
  value,
  children,
}: {
  value: ConversationStickinessValue;
  children: ReactNode;
}) {
  return (
    <ConversationStickinessContext.Provider value={value}>
      {children}
    </ConversationStickinessContext.Provider>
  );
}

function useConversationStickiness(): ConversationStickinessValue {
  const value = useContext(ConversationStickinessContext);
  if (!value) {
    throw new Error("ConversationScrollButton requires ConversationStickinessProvider");
  }
  return value;
}

export type ConversationProps = HTMLAttributes<HTMLDivElement>;

export const Conversation = ({ className, ...props }: ConversationProps) => (
  <div
    className={cn("relative flex min-h-0 flex-1 flex-col overflow-hidden", className)}
    role="log"
    {...props}
  />
);

export type ConversationContentProps = HTMLAttributes<HTMLDivElement> & {
  scrollClassName?: string;
};

/** Layout wrapper for non-virtualized content (empty state). */
export const ConversationContent = ({
  className,
  scrollClassName: _scrollClassName,
  ...props
}: ConversationContentProps) => (
  <div className={cn("flex min-h-0 flex-1 flex-col", className)} {...props} />
);

export type ConversationScrollButtonProps = ComponentProps<typeof Button>;

export const ConversationScrollButton = ({
  className,
  ...props
}: ConversationScrollButtonProps) => {
  const { isAtBottom, scrollToLatest } = useConversationStickiness();

  const handleScrollToLatest = useCallback(() => {
    scrollToLatest();
  }, [scrollToLatest]);

  if (isAtBottom) {
    return null;
  }

  return (
    <Button
      className={cn(
        "absolute bottom-4 left-[50%] translate-x-[-50%] rounded-full dark:bg-background dark:hover:bg-muted",
        className,
      )}
      onClick={handleScrollToLatest}
      size="icon"
      type="button"
      variant="outline"
      {...props}
    >
      <ArrowDownIcon className="size-4" />
    </Button>
  );
};
