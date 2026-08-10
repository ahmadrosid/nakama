import {
  ArrowDown01Icon,
  CheckmarkCircle01Icon,
  Maximize01Icon,
  Minimize01Icon,
} from "hugeicons-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ArtifactAttachmentPanelActions({
  copied,
  loading,
  content,
  copyDisabled = false,
  fullscreen,
  downloadLabel,
  downloadUrl,
  filename,
  onCopy,
  onToggleFullscreen,
  additionalMenuItems,
}: {
  copied: boolean;
  loading: boolean;
  content: string | null;
  copyDisabled?: boolean;
  fullscreen: boolean;
  downloadLabel: string;
  downloadUrl: string;
  filename: string;
  onCopy: () => void;
  onToggleFullscreen: () => void;
  additionalMenuItems?: React.ReactNode;
}) {
  return (
    <>
      <div className="inline-flex h-7 items-stretch overflow-hidden rounded-md border border-border bg-muted">
        <button
          className="px-2.5 font-medium text-foreground text-xs transition-colors hover:bg-muted/80 disabled:pointer-events-none disabled:opacity-50"
          disabled={copyDisabled || (loading && !content)}
          onClick={onCopy}
          type="button"
        >
          {copied ? (
            <span className="inline-flex items-center gap-1.5">
              <CheckmarkCircle01Icon
                aria-hidden
                className="size-3.5 text-emerald-600 dark:text-emerald-400"
              />
              Copied
            </span>
          ) : (
            "Copy"
          )}
        </button>
        <div aria-hidden className="w-px self-stretch bg-border" />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                aria-label="More artifact actions"
                className="inline-flex items-center justify-center px-1.5 text-foreground transition-colors hover:bg-muted/80"
                type="button"
              />
            }
          >
            <ArrowDown01Icon aria-hidden className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuItem
              className="cursor-pointer"
              onClick={() => {
                const link = document.createElement("a");
                link.href = downloadUrl;
                link.download = filename;
                link.rel = "noopener";
                document.body.append(link);
                link.click();
                link.remove();
              }}
            >
              {downloadLabel}
            </DropdownMenuItem>
            {additionalMenuItems}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Button
        aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        onClick={onToggleFullscreen}
        size="icon-sm"
        title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
        type="button"
        variant="ghost"
      >
        {fullscreen ? (
          <Minimize01Icon aria-hidden className="size-4" />
        ) : (
          <Maximize01Icon aria-hidden className="size-4" />
        )}
      </Button>
    </>
  );
}
