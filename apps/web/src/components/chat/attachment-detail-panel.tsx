import { XIcon } from "lucide-react";
import { useCallback, useRef, type PointerEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MIN_PANEL_WIDTH = 320;
const MAX_PANEL_WIDTH_RATIO = 0.75;

interface AttachmentDetailPanelProps {
  title: string;
  children: ReactNode;
  headerActions?: ReactNode;
  bodyClassName?: string;
  resizable?: boolean;
  fullscreen?: boolean;
  width: number;
  onWidthChange: (width: number) => void;
  onClose: () => void;
  className?: string;
}

export function AttachmentDetailPanel({
  title,
  children,
  headerActions,
  bodyClassName,
  resizable = true,
  fullscreen = false,
  width,
  onWidthChange,
  onClose,
  className,
}: AttachmentDetailPanelProps) {
  const draggingRef = useRef(false);

  const clampWidth = useCallback((nextWidth: number) => {
    const maxWidth = Math.floor(window.innerWidth * MAX_PANEL_WIDTH_RATIO);
    return Math.min(maxWidth, Math.max(MIN_PANEL_WIDTH, nextWidth));
  }, []);

  const updateWidthFromPointer = useCallback(
    (clientX: number) => {
      onWidthChange(clampWidth(window.innerWidth - clientX));
    },
    [clampWidth, onWidthChange],
  );

  function handleResizePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!resizable || fullscreen) {
      return;
    }

    event.preventDefault();
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    updateWidthFromPointer(event.clientX);
  }

  function handleResizePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) {
      return;
    }

    updateWidthFromPointer(event.clientX);
  }

  function handleResizePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) {
      return;
    }

    draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }

  return (
    <aside
      data-slot="attachment-detail-panel"
      style={fullscreen ? undefined : { width }}
      className={cn(
        "relative flex min-h-0 shrink-0 flex-col border-l border-border bg-background",
        fullscreen ? "min-w-0 flex-1" : "max-w-[75vw]",
        className,
      )}
    >
      {resizable && !fullscreen ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panel"
          className="absolute inset-y-0 left-0 z-10 w-1.5 -translate-x-1/2 cursor-col-resize touch-none before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-transparent hover:before:bg-border active:before:bg-border"
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerUp}
          onPointerCancel={handleResizePointerUp}
        />
      ) : null}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h2>
          <div className="flex shrink-0 items-center gap-1">
            {headerActions}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Close attachment panel"
              onClick={onClose}
            >
              <XIcon className="size-4" />
            </Button>
          </div>
        </div>
        <div className={cn("min-h-0 flex-1 overflow-y-auto p-4", bodyClassName)}>{children}</div>
      </div>
    </aside>
  );
}
