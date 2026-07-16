import {
  CheckIcon,
  ChevronDownIcon,
  Maximize2Icon,
  Minimize2Icon,
} from "lucide-react";
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
          type="button"
          className="px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/80 disabled:pointer-events-none disabled:opacity-50"
          disabled={loading && !content}
          onClick={onCopy}
        >
          {copied ? (
            <span className="inline-flex items-center gap-1.5">
              <CheckIcon
                className="size-3.5 text-emerald-600 dark:text-emerald-400"
                aria-hidden
              />
              Copied
            </span>
          ) : (
            "Copy"
          )}
        </button>
        <div className="w-px self-stretch bg-border" aria-hidden />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label="More artifact actions"
                className="inline-flex items-center justify-center px-1.5 text-foreground transition-colors hover:bg-muted/80"
              />
            }
          >
            <ChevronDownIcon className="size-3.5" aria-hidden />
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
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
        onClick={onToggleFullscreen}
      >
        {fullscreen ? (
          <Minimize2Icon className="size-4" aria-hidden />
        ) : (
          <Maximize2Icon className="size-4" aria-hidden />
        )}
      </Button>
    </>
  );
}
