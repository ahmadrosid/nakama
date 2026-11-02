import type { TransferProgress as OnProgress } from "@nakama/client";
import { cn } from "@nakama/ui/utils";
import { useCallback, useRef, useState } from "react";
import { formatDataPortabilityBytes } from "@/hooks/use-data-portability";

export interface TransferState {
  label: string;
  loaded: number;
  /** 0 while the server works and there is nothing to count. */
  total: number;
}

export function useTransferProgress() {
  const [transfer, setTransfer] = useState<TransferState | null>(null);
  const lastStep = useRef(-1);

  const begin = useCallback((label: string) => {
    lastStep.current = -1;
    setTransfer({ label, loaded: 0, total: 0 });
  }, []);

  // A large download arrives in thousands of chunks; re-render once per
  // percent (or per MB when the size is unknown), not once per chunk.
  const track = useCallback(
    (label: string, serverLabel?: string): OnProgress =>
      (loaded, total) => {
        if (serverLabel && total > 0 && loaded >= total) {
          setTransfer({ label: serverLabel, loaded: 0, total: 0 });

          return;
        }

        const step =
          total > 0
            ? Math.floor((loaded / total) * 100)
            : Math.floor(loaded / (1024 * 1024));

        if (step === lastStep.current) {
          return;
        }

        lastStep.current = step;
        setTransfer({ label, loaded, total });
      },
    []
  );

  const clear = useCallback(() => setTransfer(null), []);

  return { begin, clear, track, transfer };
}

export function TransferProgressBar({ label, loaded, total }: TransferState) {
  const percent =
    total > 0 ? Math.min(100, Math.floor((loaded / total) * 100)) : null;

  const detail =
    total > 0
      ? `${formatDataPortabilityBytes(loaded)} of ${formatDataPortabilityBytes(total)}`
      : loaded > 0
        ? formatDataPortabilityBytes(loaded)
        : null;

  return (
    <div className="space-y-1.5" role="status">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="text-pretty text-foreground">{label}</span>
        {detail ? (
          <span className="shrink-0 text-muted-foreground tabular-nums">
            {detail}
            {percent === null ? null : ` (${percent}%)`}
          </span>
        ) : null}
      </div>
      <div
        aria-label={label}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={percent ?? undefined}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
      >
        <div
          className={cn(
            "h-full rounded-full bg-primary",
            percent === null
              ? "w-full animate-pulse motion-reduce:animate-none motion-reduce:opacity-60"
              : "transition-[width] duration-200 motion-reduce:transition-none"
          )}
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
