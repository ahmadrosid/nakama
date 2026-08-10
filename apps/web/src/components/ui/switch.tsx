import { cn } from "@/lib/utils";

type SwitchProps = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
  size?: "default" | "sm";
  "aria-label"?: string;
};

const switchSizes = {
  default: {
    off: "translate-x-0.5",
    on: "translate-x-5",
    thumb: "size-5",
    track: "h-6 w-11",
  },
  sm: {
    off: "translate-x-0.5",
    on: "translate-x-4",
    thumb: "size-4",
    track: "h-5 w-9",
  },
} as const;

function Switch({
  checked,
  onCheckedChange,
  disabled,
  id,
  className,
  size = "default",
  "aria-label": ariaLabel,
}: SwitchProps) {
  const dimensions = switchSizes[size];

  return (
    <button
      aria-checked={checked}
      aria-label={ariaLabel}
      className={cn(
        "relative inline-flex shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
        dimensions.track,
        checked ? "bg-primary" : "bg-muted",
        className
      )}
      disabled={disabled}
      id={id}
      onClick={() => onCheckedChange(!checked)}
      role="switch"
      type="button"
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none block rounded-full bg-background shadow-sm transition-transform",
          dimensions.thumb,
          checked ? dimensions.on : dimensions.off
        )}
      />
    </button>
  );
}

export { Switch };
