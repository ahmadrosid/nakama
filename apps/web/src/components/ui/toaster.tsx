import { CheckCircle2Icon } from "lucide-react";
import { useToasts } from "@/lib/toast";
import { cn } from "@/lib/utils";

export function Toaster() {
  const toasts = useToasts();

  return (
    <div
      aria-live="polite"
      aria-relevant="additions"
      className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-full max-w-sm flex-col gap-2"
    >
      {toasts.map((item) => (
        <div
          className={cn(
            "pointer-events-auto flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-lg",
            "fade-in-0 slide-in-from-bottom-2 animate-in"
          )}
          key={item.id}
          role="status"
        >
          <CheckCircle2Icon
            aria-hidden="true"
            className="mt-0.5 size-5 shrink-0 text-emerald-400"
          />
          <p className="text-foreground text-sm">{item.message}</p>
        </div>
      ))}
    </div>
  );
}
