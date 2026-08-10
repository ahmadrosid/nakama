import { Cancel01Icon } from "hugeicons-react";
import {
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { clampAttachmentPanelWidth } from "@/components/chat/attachment-panel-width";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface AttachmentDetailPanelProps {
  bodyClassName?: string;
  children: ReactNode;
  className?: string;
  fullscreen?: boolean;
  headerActions?: ReactNode;
  onClose: () => void;
  onWidthChange: (width: number) => void;
  resizable?: boolean;
  subtitle?: string | null;
  title: string;
  width: number;
}

export function AttachmentDetailPanel({
  title,
  subtitle,
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

  const clampWidth = useCallback(
    (nextWidth: number) => clampAttachmentPanelWidth(nextWidth),
    []
  );

  useEffect(() => {
    if (fullscreen) {
      return;
    }

    function handleResize() {
      const clamped = clampWidth(width);
      if (clamped !== width) {
        onWidthChange(clamped);
      }
    }

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [clampWidth, fullscreen, onWidthChange, width]);

  const updateWidthFromPointer = useCallback(
    (clientX: number) => {
      onWidthChange(clampWidth(window.innerWidth - clientX));
    },
    [clampWidth, onWidthChange]
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
      className={cn(
        "relative flex min-h-0 shrink-0 flex-col border-border border-l bg-background",
        fullscreen
          ? "left-0 w-full min-w-0 flex-1"
          : "max-w-[50vw] lg:max-w-[75vw]",
        className
      )}
      data-slot="attachment-detail-panel"
      style={fullscreen ? undefined : { width }}
    >
      {resizable && !fullscreen ? (
        <div
          aria-label="Resize panel"
          aria-orientation="vertical"
          className="absolute inset-y-0 left-0 z-10 w-1.5 -translate-x-1/2 cursor-col-resize touch-none before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-transparent hover:before:bg-border active:before:bg-border"
          onPointerCancel={handleResizePointerUp}
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerUp}
          role="separator"
        />
      ) : null}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-3 border-border border-b px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-medium text-sm">{title}</h2>
            {subtitle ? (
              <p className="mt-0.5 truncate text-muted-foreground text-xs">
                {subtitle}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {headerActions}
            <Button
              aria-label="Close attachment panel"
              onClick={onClose}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <Cancel01Icon className="size-4" />
            </Button>
          </div>
        </div>
        <div
          className={cn("min-h-0 flex-1 overflow-y-auto p-4", bodyClassName)}
        >
          {children}
        </div>
      </div>
    </aside>
  );
}
