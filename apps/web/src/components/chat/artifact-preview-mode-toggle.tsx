import { CodeSquareIcon, ViewIcon } from "hugeicons-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ArtifactPreviewMode = "preview" | "source";

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
      className="inline-flex shrink-0 items-center rounded-md bg-muted p-0.5"
      role="group"
    >
      <Button
        aria-label="Rendered"
        aria-pressed={mode === "preview"}
        className={cn(
          "size-6 rounded-sm",
          mode === "preview"
            ? "border-border bg-background text-foreground shadow-sm hover:bg-background"
            : "text-muted-foreground"
        )}
        onClick={() => onChange("preview")}
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        <ViewIcon aria-hidden className="size-3.5" />
      </Button>
      <Button
        aria-label="Code"
        aria-pressed={mode === "source"}
        className={cn(
          "size-6 rounded-sm",
          mode === "source"
            ? "border-border bg-background text-foreground shadow-sm hover:bg-background"
            : "text-muted-foreground"
        )}
        onClick={() => onChange("source")}
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        <CodeSquareIcon aria-hidden className="size-3.5" />
      </Button>
    </div>
  );
}
