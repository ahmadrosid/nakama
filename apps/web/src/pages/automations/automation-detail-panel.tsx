import type { StoredAutomation } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import { Card, CardContent } from "@nakama/ui/card";
import { ConfirmDialog } from "@nakama/ui/dialog";
import { Spinner } from "@nakama/ui/spinner";
import { Switch } from "@nakama/ui/switch";
import { cn } from "@nakama/ui/utils";
import {
  Copy01Icon,
  PencilEdit02Icon,
  PlayIcon,
  RefreshIcon,
} from "hugeicons-react";
import { useState } from "react";
import { useCreateAutomationWebhookSecretMutation } from "@/hooks/use-automations";
import { formatFutureRelativeTime } from "@/lib/chat-history";
import { formatError } from "@/lib/client";
import { buildNotificationWebhookUrl } from "@/lib/notification-destinations";
import {
  ListSkeleton,
  RunHistoryList,
} from "@/pages/automations/automations-components";
import { describeTrigger } from "@/pages/automations/automations-page.shared";
import type { AutomationsPageState } from "@/pages/automations/use-automations-page";

type DetailState = Pick<
  AutomationsPageState,
  | "selected"
  | "busy"
  | "runningId"
  | "handleRun"
  | "handleToggleEnabled"
  | "openEdit"
  | "setDeleteTarget"
  | "selectedProfileName"
  | "selectedRunSummary"
  | "runs"
  | "runsLoading"
>;

function Fact({
  label,
  value,
  note,
  noteClassName,
}: {
  label: string;
  value: string;
  note?: string;
  noteClassName?: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-muted/30 px-3.5 py-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 font-semibold text-[15px]">{value}</p>
      {note ? (
        <p
          className={cn("mt-0.5 text-muted-foreground text-xs", noteClassName)}
        >
          {note}
        </p>
      ) : null}
    </div>
  );
}

function AutomationSummaryCard({
  selected,
  busy,
  runningId,
  handleRun,
  handleToggleEnabled,
  openEdit,
  setDeleteTarget,
  selectedProfileName,
  selectedRunSummary,
  runCount,
}: Pick<
  DetailState,
  | "busy"
  | "runningId"
  | "handleRun"
  | "handleToggleEnabled"
  | "openEdit"
  | "setDeleteTarget"
  | "selectedProfileName"
  | "selectedRunSummary"
> & { selected: StoredAutomation; runCount: number }) {
  const schedule = describeTrigger(selected.trigger);
  const { completed, failed } = selectedRunSummary;

  const nextRun = selected.nextRunAt
    ? formatFutureRelativeTime(selected.nextRunAt)
    : "Not scheduled";

  return (
    <Card className="overflow-hidden shadow-none">
      <CardContent className="space-y-4 p-0">
        <div className="space-y-4 px-5 pt-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="min-w-0 text-balance font-semibold text-lg">
                {selected.name}
              </h2>
              {selected.description ? (
                <p className="type-body mt-1 text-pretty text-sm">
                  {selected.description}
                </p>
              ) : null}
            </div>
            <label className="flex shrink-0 items-center gap-2 font-medium text-sm">
              {selected.enabled ? "On" : "Off"}
              <Switch
                aria-label="Automation on"
                checked={selected.enabled}
                disabled={busy}
                onCheckedChange={(enabled) =>
                  void handleToggleEnabled(selected, enabled)
                }
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Fact label="Runs" note={schedule.note} value={schedule.label} />
            <Fact
              label="Next run"
              value={nextRun.charAt(0).toUpperCase() + nextRun.slice(1)}
            />
            <Fact
              label="Results"
              note={failed > 0 ? `${failed} had problems` : undefined}
              noteClassName="text-amber-700 dark:text-amber-400"
              value={
                runCount === 0
                  ? "No runs yet"
                  : `${completed} of ${runCount} worked`
              }
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-border border-t bg-muted/30 px-5 py-3">
          <Button
            className="px-3.5"
            disabled={busy}
            onClick={() => openEdit(selected)}
            size="lg"
            type="button"
            variant="outline"
          >
            <PencilEdit02Icon aria-hidden className="size-4" />
            Edit
          </Button>
          <Button
            className="px-3.5"
            disabled={busy || runningId !== null}
            onClick={() => void handleRun(selected.id)}
            size="lg"
            type="button"
          >
            {runningId === selected.id ? (
              <Spinner className="size-3.5" />
            ) : (
              <PlayIcon aria-hidden className="size-4" />
            )}
            Run now
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <p className="text-muted-foreground text-sm">
              Done by{" "}
              <span className="font-medium text-foreground">
                {selectedProfileName}
              </span>
              {selected.toolLimit ? " · Limited tools" : null}
            </p>
            <Button
              className="px-3.5 text-destructive hover:text-destructive"
              disabled={busy}
              onClick={() => setDeleteTarget(selected)}
              size="lg"
              type="button"
              variant="ghost"
            >
              Delete
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CopyValue({ value }: { value: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }

    window.setTimeout(() => setStatus("idle"), 2000);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="max-w-full break-all rounded-md border border-border bg-background px-2.5 py-1 text-xs">
        {value}
      </code>
      <Button
        onClick={() => void copy()}
        size="sm"
        type="button"
        variant="outline"
      >
        <Copy01Icon aria-hidden className="size-4" />
        {status === "copied"
          ? "Copied"
          : status === "failed"
            ? "Copy failed"
            : "Copy"}
      </Button>
    </div>
  );
}

function WebhookCard({
  automationId,
  webhookUrl,
}: {
  automationId: string;
  webhookUrl?: string;
}) {
  const createSecret = useCreateAutomationWebhookSecretMutation();
  const [secret, setSecret] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const url =
    webhookUrl ??
    buildNotificationWebhookUrl(
      window.location.origin,
      `/v1/automations/${encodeURIComponent(automationId)}/webhook`
    );

  async function handleCreate(): Promise<void> {
    try {
      setSecret(await createSecret.mutateAsync(automationId));
    } catch (error) {
      // The dialog stays open and shows this message.
      throw new Error(formatError(error));
    }
  }

  return (
    <Card className="shadow-none">
      <CardContent className="space-y-3 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-medium text-sm">Webhook</h3>
          <Button
            disabled={createSecret.isPending}
            onClick={() => setConfirmOpen(true)}
            size="sm"
            type="button"
            variant="outline"
          >
            <RefreshIcon aria-hidden className="size-3.5" />
            New secret
          </Button>
        </div>
        <CopyValue value={url} />
        {secret ? (
          <div className="space-y-2">
            <p
              className="text-emerald-700 text-xs dark:text-emerald-300"
              role="status"
            >
              Copy it now. It will not be shown again.
            </p>
            <CopyValue value={secret} />
          </div>
        ) : null}
        {confirmOpen ? (
          <ConfirmDialog
            confirmLabel="Make secret"
            description="Any old secret stops working at once."
            onClose={() => setConfirmOpen(false)}
            onConfirm={handleCreate}
            title="Make a new webhook secret?"
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

export function AutomationDetailPanel(state: DetailState) {
  const {
    selected,
    busy,
    runningId,
    handleRun,
    handleToggleEnabled,
    openEdit,
    setDeleteTarget,
    selectedProfileName,
    selectedRunSummary,
    runs,
    runsLoading,
  } = state;

  if (!selected) {
    return null;
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-3xl space-y-8">
      <AutomationSummaryCard
        busy={busy}
        handleRun={handleRun}
        handleToggleEnabled={handleToggleEnabled}
        openEdit={openEdit}
        runCount={runs.length}
        runningId={runningId}
        selected={selected}
        selectedProfileName={selectedProfileName}
        selectedRunSummary={selectedRunSummary}
        setDeleteTarget={setDeleteTarget}
      />

      {selected.trigger.type === "webhook" ? (
        <WebhookCard
          automationId={selected.id}
          webhookUrl={selected.webhookUrl}
        />
      ) : null}

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-medium text-muted-foreground text-sm">
            Run history
          </h3>
          <p className="type-body text-xs">
            {runsLoading
              ? "Loading runs…"
              : runs.length === 0
                ? "No runs yet"
                : `${runs.length} run${runs.length === 1 ? "" : "s"}`}
          </p>
        </div>

        {runsLoading ? (
          <ListSkeleton rows={3} />
        ) : runs.length === 0 ? (
          <Card className="min-h-[10rem] items-center justify-center shadow-none">
            <p className="type-body text-muted-foreground text-xs">
              No runs yet.
            </p>
          </Card>
        ) : (
          <RunHistoryList
            busy={busy}
            onRerun={() => void handleRun(selected.id)}
            profileId={selected.profileId}
            running={runningId === selected.id}
            runs={runs}
          />
        )}
      </section>
    </div>
  );
}
