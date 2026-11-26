import { Button } from "@nakama/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nakama/ui/dialog";
import { FormField } from "@nakama/ui/form-field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@nakama/ui/input-group";
import { Spinner } from "@nakama/ui/spinner";
import { toast } from "@nakama/ui/toast";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { usePrunableAuditEvents } from "@/hooks/use-audit-events";
import { client, formatError } from "@/lib/client";

const DEFAULT_RETENTION_DAYS = 365;

const MAX_RETENTION_DAYS = 3650;

const COUNT_FORMAT = new Intl.NumberFormat();

function formatRowsLabel(count: number): string {
  return `${COUNT_FORMAT.format(count)} ${count === 1 ? "row" : "rows"}`;
}

function parseRetentionDays(raw: string): number | null {
  const trimmed = raw.trim();

  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const parsed = Number(trimmed);

  return Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_RETENTION_DAYS
    ? parsed
    : null;
}

async function applyAuditRetentionAndPrune({
  days,
  onPruned,
  queryClient,
  savedDays,
}: {
  days: number;
  onPruned?: () => void;
  queryClient: QueryClient;
  savedDays: number | undefined;
}): Promise<void> {
  if (days !== savedDays) {
    await client.updateAuditRetention(days);
    await queryClient.invalidateQueries({
      queryKey: ["auditEventCategories"],
    });
  }

  if (days === 0) {
    await queryClient.invalidateQueries({ queryKey: ["auditEvents"] });
    toast("Retention off: audit rows are kept forever");

    return;
  }

  const result = await client.pruneAuditEvents();
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["auditEvents"] }),
    queryClient.invalidateQueries({ queryKey: ["auditEventCategories"] }),
    queryClient.invalidateQueries({ queryKey: ["auditEventsPrunable"] }),
  ]);
  onPruned?.();

  const formattedDays = COUNT_FORMAT.format(result.retentionDays);

  if (result.deleted > 0) {
    const suffix = result.hasMore
      ? " (more older rows remain — run Prune again)"
      : "";

    toast(
      `Pruned ${formatRowsLabel(result.deleted)} older than ${formattedDays} days${suffix}`
    );

    return;
  }

  toast(`Nothing older than ${formattedDays} days to prune`);
}

export function AuditPruneDialog({
  open,
  onOpenChange,
  savedDays,
  onPruned,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  savedDays: number | undefined;
  onPruned?: () => void;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!(next || busy)) {
          onOpenChange(false);
        }
      }}
      open={open}
    >
      <DialogContent showCloseButton={!busy}>
        {open ? (
          <AuditPruneForm
            busy={busy}
            key={savedDays ?? DEFAULT_RETENTION_DAYS}
            onBusyChange={setBusy}
            onClose={() => onOpenChange(false)}
            onPruned={onPruned}
            savedDays={savedDays}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function AuditPruneForm({
  busy,
  onBusyChange,
  onClose,
  onPruned,
  savedDays,
}: {
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  onClose: () => void;
  onPruned?: () => void;
  savedDays: number | undefined;
}) {
  const queryClient = useQueryClient();
  const initialDays = savedDays ?? DEFAULT_RETENTION_DAYS;
  const [value, setValue] = useState(() => String(initialDays));
  const [previewDays, setPreviewDays] = useState(initialDays);
  const [error, setError] = useState<string | null>(null);
  const debounceTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
    },
    []
  );

  const parsed = parseRetentionDays(value);
  const valid = parsed !== null;
  const isKeepingForever = parsed === 0;

  const preview = usePrunableAuditEvents(previewDays, previewDays > 0 && valid);

  function handleValueChange(nextValue: string) {
    setValue(nextValue);
    setError(null);

    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
    }

    const nextDays = parseRetentionDays(nextValue);

    if (nextDays === null) {
      return;
    }

    debounceTimerRef.current = window.setTimeout(() => {
      setPreviewDays(nextDays);
    }, 300);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (parsed === null || busy) {
      return;
    }

    onBusyChange(true);
    setError(null);

    try {
      await applyAuditRetentionAndPrune({
        days: parsed,
        onPruned,
        queryClient,
        savedDays,
      });
      onClose();
    } catch (cause) {
      setError(formatError(cause) || "Failed to prune audit events");
    } finally {
      onBusyChange(false);
    }
  }

  return (
    <form className="grid gap-4" onSubmit={(event) => void handleSubmit(event)}>
      <DialogHeader>
        <DialogTitle>Prune audit log</DialogTitle>
        <DialogDescription>
          Rows past retention are pruned automatically during new writes. Prune
          updates the window and cleans older rows now.
        </DialogDescription>
      </DialogHeader>

      <FormField
        footer={
          <p
            className={
              valid
                ? "text-muted-foreground text-xs"
                : "text-destructive text-xs"
            }
          >
            {valid
              ? "0 keeps every row forever."
              : `Enter a whole number from 0 to ${MAX_RETENTION_DAYS}.`}
          </p>
        }
        id="audit-retention-days"
        label="Keep audit rows for"
      >
        <InputGroup>
          <InputGroupInput
            aria-invalid={!valid}
            id="audit-retention-days"
            inputMode="numeric"
            onChange={(event) => handleValueChange(event.target.value)}
            value={value}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupText>days</InputGroupText>
          </InputGroupAddon>
        </InputGroup>
      </FormField>

      {parsed !== null && parsed > 0 ? (
        <PrunePreviewText
          days={parsed}
          isPending={preview.isPending || previewDays !== parsed}
          rows={preview.data?.rows ?? 0}
        />
      ) : null}

      <p className="text-muted-foreground text-xs">
        Verify keeps working after a prune: it checks the chain from the oldest
        kept row.
      </p>

      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}

      <DialogFooter>
        <Button
          disabled={busy}
          onClick={onClose}
          type="button"
          variant="outline"
        >
          Cancel
        </Button>
        <Button
          disabled={!valid || busy}
          type="submit"
          variant={isKeepingForever ? "default" : "destructive"}
        >
          {busy ? <Spinner className="size-4" /> : null}
          {isKeepingForever ? "Save" : "Save & prune"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function PrunePreviewText({
  days,
  isPending,
  rows,
}: {
  days: number;
  isPending: boolean;
  rows: number;
}) {
  const formattedDays = COUNT_FORMAT.format(days);

  if (isPending) {
    return (
      <p aria-live="polite" className="text-muted-foreground text-sm">
        Counting rows older than {formattedDays} days…
      </p>
    );
  }

  if (rows > 0) {
    return (
      <p aria-live="polite" className="text-sm">
        <span className="font-medium tabular-nums">
          {formatRowsLabel(rows)}
        </span>{" "}
        older than {formattedDays} days will be removed. Export JSONL first if
        you need a copy.
      </p>
    );
  }

  return (
    <p aria-live="polite" className="text-muted-foreground text-sm">
      No row is older than {formattedDays} days yet.
    </p>
  );
}
