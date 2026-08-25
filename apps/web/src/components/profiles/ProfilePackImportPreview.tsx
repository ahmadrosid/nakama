import type { ProfilePackPreviewResponse } from "@nakama/core/contract";
import { Alert02Icon, Archive01Icon } from "hugeicons-react";
import { cn } from "@/lib/utils";

interface ProfilePackImportPreviewProps {
  error: string | null;
  fileName: string;
  inspecting: boolean;
  preview: ProfilePackPreviewResponse | null;
}

export function ProfilePackImportPreview({
  error,
  fileName,
  inspecting,
  preview,
}: ProfilePackImportPreviewProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-start gap-3 p-3">
        <div
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
        >
          <Archive01Icon className="size-4" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="truncate font-medium text-foreground text-sm">
            {fileName}
          </p>
          {inspecting ? (
            <p className="text-muted-foreground text-xs">Checking file…</p>
          ) : preview ? (
            <p className="text-pretty text-muted-foreground text-xs">
              Will create{" "}
              <span className="font-medium text-foreground">
                {preview.plannedName}
              </span>
            </p>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="border-border border-t p-3">
          <div
            className={cn(
              "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
              "border-destructive/30 bg-destructive/10 text-destructive"
            )}
            role="alert"
          >
            <Alert02Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span className="text-pretty">{error}</span>
          </div>
        </div>
      ) : null}

      {preview ? (
        <div className="space-y-3 border-border border-t p-3">
          {preview.topLevelPaths.length > 0 ? (
            <div className="space-y-1.5">
              <p className="font-medium text-muted-foreground text-xs">
                Included
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {preview.topLevelPaths.map((path) => (
                  <li
                    className="rounded-md bg-muted px-2 py-0.5 font-mono text-2xs text-muted-foreground"
                    key={path}
                  >
                    {path}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {preview.skippedAssignments.length > 0 ? (
            <div className="space-y-1.5">
              <p className="font-medium text-muted-foreground text-xs">
                Skipped — not found in this org
              </p>
              <ul className="space-y-1">
                {preview.skippedAssignments.map((item) => (
                  <li
                    className="rounded-md bg-amber-500/10 px-2 py-1 text-amber-700 text-xs dark:text-amber-400"
                    key={item.path}
                  >
                    <span className="font-mono">{item.path}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      — {item.reason}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
