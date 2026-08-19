import { ArrowRight01Icon } from "hugeicons-react";
import { Button } from "@/components/ui/button";
import { artifactFolderSegments } from "@/pages/files/files-artifact-folders";

export function ArtifactFolderBreadcrumb({
  prefix,
  onNavigate,
}: {
  prefix: string;
  onNavigate: (prefix: string) => void;
}) {
  const segments = artifactFolderSegments(prefix);
  if (segments.length === 0) {
    return null;
  }

  return (
    <nav
      aria-label="Folder"
      className="flex min-w-0 flex-wrap items-center gap-0.5 text-sm"
    >
      <Button
        className="h-auto px-1.5 py-0.5 text-muted-foreground"
        onClick={() => onNavigate("")}
        size="sm"
        type="button"
        variant="ghost"
      >
        Artifacts
      </Button>
      {segments.map((segment, index) => {
        const isCurrent = index === segments.length - 1;
        return (
          <span
            className="flex min-w-0 items-center gap-0.5"
            key={segment.prefix}
          >
            <ArrowRight01Icon
              aria-hidden
              className="size-3 shrink-0 text-muted-foreground"
            />
            {isCurrent ? (
              <span className="truncate px-1.5 py-0.5 font-medium text-foreground">
                {segment.name}
              </span>
            ) : (
              <Button
                className="h-auto max-w-full truncate px-1.5 py-0.5 text-muted-foreground"
                onClick={() => onNavigate(segment.prefix)}
                size="sm"
                type="button"
                variant="ghost"
              >
                {segment.name}
              </Button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
