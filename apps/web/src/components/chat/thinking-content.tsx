import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ThinkingContentProps {
  children: ReactNode;
  className?: string;
  clamped?: boolean;
}

export function ThinkingContent({
  children,
  className,
  clamped = true,
}: ThinkingContentProps) {
  return (
    <div
      className={cn(
        "whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground",
        clamped &&
          "no-scrollbar max-h-[calc(1.625rem*4)] overflow-y-auto [mask-image:linear-gradient(to_bottom,transparent,black_0.75rem,black_calc(100%-0.75rem),transparent)] [-webkit-mask-image:linear-gradient(to_bottom,transparent,black_0.75rem,black_calc(100%-0.75rem),transparent)]",
        className,
      )}
    >
      {children}
    </div>
  );
}
