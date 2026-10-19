import { Button } from "@nakama/ui/button";
import { cn } from "@nakama/ui/utils";
import { CodeSquareIcon, ViewIcon } from "hugeicons-react";

export type ArtifactPreviewMode = "preview" | "source";

const MODES: {
  Icon: typeof ViewIcon;
  label: string;
  value: ArtifactPreviewMode;
}[] = [
  { Icon: ViewIcon, label: "Preview", value: "preview" },
  { Icon: CodeSquareIcon, label: "Code", value: "source" },
];

export function ArtifactPreviewModeToggle({
  mode,
  onChange,
}: {
  mode: ArtifactPreviewMode;
  onChange: (mode: ArtifactPreviewMode) => void;
}) {
  return (
    <div
      aria-label="Preview mode"
      className="inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-muted p-0.5"
      role="group"
    >
      {/* Text labels need room; narrow panels (no @lg container) get icons. */}
      {MODES.map(({ Icon, label, value }) => (
        <Button
          aria-label={label}
          aria-pressed={mode === value}
          className={cn(
            "rounded-md @lg:px-3 px-1.5 font-medium",
            mode === value
              ? "bg-background text-foreground shadow-sm hover:bg-background"
              : "text-muted-foreground"
          )}
          key={value}
          onClick={() => onChange(value)}
          size="xs"
          type="button"
          variant="ghost"
        >
          <Icon aria-hidden className="@lg:hidden size-3.5" />
          <span className="@lg:inline hidden">{label}</span>
        </Button>
      ))}
    </div>
  );
}
