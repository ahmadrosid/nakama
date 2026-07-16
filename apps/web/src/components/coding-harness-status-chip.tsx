import { cn } from "@/lib/utils";

export type CodingHarnessStatusChipVariant = "solid-ok" | "ok" | "solid-warn" | "muted";

export function CodingHarnessStatusChip({
  variant,
  label,
}: {
  variant: CodingHarnessStatusChipVariant;
  label: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5",
        variant === "solid-ok" && "bg-primary text-primary-foreground",
        variant === "ok" && "border border-primary/20 bg-primary/5 text-primary",
        variant === "solid-warn" && "bg-accent-500/15 text-accent-600 dark:text-accent-400",
        variant === "muted" && "bg-muted/80 text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}
