import { XIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import { clampAttachmentPanelWidth } from "@/components/chat/attachment-panel-width";
import { cn } from "@/lib/utils";

const WIDTH_MOTION_MS = 200;

interface AttachmentDetailPanelProps {
  title: string;
  subtitle?: string | null;
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
  const asideRef = useRef<HTMLElement>(null);
  const draggingRef = useRef(false);
  const prevFullscreenRef = useRef(fullscreen);
  const [displayWidth, setDisplayWidth] = useState(width);
  const [animateWidth, setAnimateWidth] = useState(false);

  const clampWidth = useCallback(
    (nextWidth: number) => clampAttachmentPanelWidth(nextWidth),
    [],
  );

  useEffect(() => {
    if (!fullscreen && !animateWidth) {
      setDisplayWidth(width);
    }
  }, [animateWidth, fullscreen, width]);

  useEffect(() => {
    if (prevFullscreenRef.current === fullscreen) {
      return;
    }

    prevFullscreenRef.current = fullscreen;
    setAnimateWidth(true);

    const frame = window.requestAnimationFrame(() => {
      if (fullscreen) {
        const parent = asideRef.current?.parentElement;
        setDisplayWidth(parent?.clientWidth ?? width);
        return;
      }

      setDisplayWidth(width);
    });

    const timeout = window.setTimeout(() => setAnimateWidth(false), WIDTH_MOTION_MS);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [fullscreen, width]);

  useEffect(() => {
    if (!fullscreen) {
      return;
    }

    function measure() {
      const parent = asideRef.current?.parentElement;
      if (parent) {
        setDisplayWidth(parent.clientWidth);
      }
    }

    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [fullscreen]);

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
      ref={asideRef}
      data-slot="attachment-detail-panel"
      style={{ width: displayWidth }}
      className={cn(
        "relative flex min-h-0 shrink-0 flex-col border-l border-border bg-background",
        animateWidth &&
          "transition-[width] duration-200 ease-out motion-reduce:transition-none",
        !fullscreen && !animateWidth && "max-w-[50vw] lg:max-w-[75vw]",
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
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-medium">{title}</h2>
            {subtitle ? (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p>
            ) : null}
          </div>
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
