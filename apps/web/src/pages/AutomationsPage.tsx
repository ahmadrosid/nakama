import type {
  AutomationRunRecord,
  AutomationTrigger,
  StoredAutomation,
} from "@tinyclaw/core/contract";
import { useCallback, useEffect, useState } from "react";
import { MessageResponse } from "@/components/ai-elements/message";
import { client, formatError } from "@/lib/client";

export function AutomationsPage() {
  const [automations, setAutomations] = useState<StoredAutomation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runs, setRuns] = useState<AutomationRunRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = automations.find((automation) => automation.id === selectedId) ?? null;

  const refreshAutomations = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const next = await client.listAutomations();
      setAutomations(next);

      if (next.length === 0) {
        setSelectedId(null);
      } else if (!selectedId || !next.some((automation) => automation.id === selectedId)) {
        setSelectedId(next[0]!.id);
      }
    } catch (err) {
      setError(formatError(err));
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    void refreshAutomations();
  }, [refreshAutomations]);

  useEffect(() => {
    if (!selectedId) {
      setRuns([]);
      return;
    }

    void client
      .listAutomationRuns(selectedId)
      .then(setRuns)
      .catch((err) => setError(formatError(err)));
  }, [selectedId]);

  async function handleUpdate(automation: StoredAutomation) {
    if (busy) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await client.updateAutomation(automation.id, {
        name: automation.name,
        description: automation.description,
        prompt: automation.prompt,
        trigger: automation.trigger,
        enabled: automation.enabled,
      });
      await refreshAutomations();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(automationId: string) {
    if (busy) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await client.deleteAutomation(automationId);
      await refreshAutomations();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRun(automationId: string) {
    if (busy) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await client.runAutomation(automationId);
      const nextRuns = await client.listAutomationRuns(automationId);
      setRuns(nextRuns);
      await refreshAutomations();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  function updateSelected(patch: Partial<StoredAutomation>) {
    if (!selected) {
      return;
    }

    setAutomations((current) =>
      current.map((automation) =>
        automation.id === selected.id ? { ...automation, ...patch } : automation,
      ),
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="panel p-5">
        <h2 className="type-section-title">Automations</h2>
        <p className="type-body mt-1">
          Saved automations run their prompt through the agent on a schedule or when you trigger
          them manually. You can also create them in chat with the agent.
        </p>
      </div>

      {error ? (
        <div className="panel border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="panel p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="type-label">Saved</h3>
            <button
              type="button"
              className="btn-secondary px-3 py-1 text-xs"
              disabled={loading}
              onClick={() => void refreshAutomations()}
            >
              Refresh
            </button>
          </div>

          {loading ? (
            <p className="type-body mt-4 text-muted-foreground">Loading…</p>
          ) : automations.length === 0 ? (
            <p className="type-body mt-4 text-muted-foreground">No automations yet.</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {automations.map((automation) => (
                <li key={automation.id}>
                  <button
                    type="button"
                    className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                      selectedId === automation.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/40"
                    }`}
                    onClick={() => setSelectedId(automation.id)}
                  >
                    <p className="text-sm font-medium text-foreground">{automation.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatTrigger(automation.trigger)}
                      {!automation.enabled ? " · disabled" : ""}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-6">
          {selected ? (
            <AutomationEditor
              automation={selected}
              busy={busy}
              onChange={updateSelected}
              onSave={() => void handleUpdate(selected)}
              onDelete={() => void handleDelete(selected.id)}
              onRun={() => void handleRun(selected.id)}
            />
          ) : (
            <div className="panel flex min-h-48 items-center justify-center p-8 text-sm text-muted-foreground">
              Select an automation to edit it.
            </div>
          )}

          {selected ? (
            <div className="panel p-5">
              <h3 className="type-section-title">Run history</h3>
              {runs.length === 0 ? (
                <p className="type-body mt-3 text-muted-foreground">No runs yet.</p>
              ) : (
                <div className="mt-4 space-y-3">
                  {runs.map((run) => (
                    <div
                      key={run.id}
                      className="rounded-lg border border-border bg-muted/30 px-4 py-3"
                    >
                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span className="font-medium uppercase tracking-wide text-foreground">
                          {run.status}
                        </span>
                        <span>{formatDate(run.startedAt)}</span>
                        {run.completedAt ? <span>→ {formatDate(run.completedAt)}</span> : null}
                      </div>
                      {run.output ? (
                        <div className="mt-3 rounded-lg border border-border/60 bg-background/50 px-4 py-3">
                          <MessageResponse>{run.output}</MessageResponse>
                        </div>
                      ) : null}
                      {run.error ? (
                        <p className="mt-3 text-sm text-red-700 dark:text-red-300">{run.error}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AutomationEditor({
  automation,
  busy,
  onChange,
  onSave,
  onDelete,
  onRun,
}: {
  automation: StoredAutomation;
  busy: boolean;
  onChange: (patch: Partial<StoredAutomation>) => void;
  onSave: () => void;
  onDelete: () => void;
  onRun: () => void;
}) {
  const scheduleTrigger =
    automation.trigger.type === "schedule" ? automation.trigger : null;
  const isSchedule = scheduleTrigger !== null;

  return (
    <div className="panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="type-section-title">{automation.name}</h2>
          <p className="type-body mt-1 text-muted-foreground">{automation.id}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" disabled={busy} onClick={onRun}>
            Run now
          </button>
          <button type="button" className="btn-primary" disabled={busy} onClick={onSave}>
            Save
          </button>
          <button type="button" className="btn-secondary" disabled={busy} onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <input
            className="input"
            value={automation.name}
            disabled={busy}
            onChange={(event) => onChange({ name: event.target.value })}
          />
        </Field>
        <Field label="Enabled">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={automation.enabled}
              disabled={busy}
              onChange={(event) => onChange({ enabled: event.target.checked })}
            />
            Run on schedule when enabled
          </label>
        </Field>
      </div>

      <div className="mt-4">
        <Field label="Description">
          <input
            className="input"
            value={automation.description}
            disabled={busy}
            onChange={(event) => onChange({ description: event.target.value })}
          />
        </Field>
      </div>

      <div className="mt-4">
        <Field label="Prompt">
          <textarea
            className="input min-h-28"
            value={automation.prompt}
            disabled={busy}
            onChange={(event) => onChange({ prompt: event.target.value })}
          />
        </Field>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Field label="Trigger">
          <select
            className="input"
            value={automation.trigger.type}
            disabled={busy}
            onChange={(event) => {
              const type = event.target.value;

              if (type === "manual") {
                onChange({ trigger: { type: "manual" } });
                return;
              }

              onChange({
                trigger: {
                  type: "schedule",
                  cron: scheduleTrigger?.cron ?? "0 8 * * *",
                  timezone: scheduleTrigger?.timezone,
                },
              });
            }}
          >
            <option value="manual">Manual</option>
            <option value="schedule">Schedule</option>
          </select>
        </Field>

        {isSchedule ? (
          <>
            <Field label="Cron">
              <input
                className="input"
                value={scheduleTrigger.cron}
                disabled={busy}
                onChange={(event) =>
                  onChange({
                    trigger: {
                      type: "schedule",
                      cron: event.target.value,
                      timezone: scheduleTrigger.timezone,
                    },
                  })
                }
              />
            </Field>
            <Field label="Timezone">
              <input
                className="input"
                value={scheduleTrigger.timezone ?? ""}
                placeholder="UTC"
                disabled={busy}
                onChange={(event) =>
                  onChange({
                    trigger: {
                      type: "schedule",
                      cron: scheduleTrigger.cron,
                      timezone: event.target.value || undefined,
                    },
                  })
                }
              />
            </Field>
          </>
        ) : null}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Meta label="Next run" value={automation.nextRunAt ? formatDate(automation.nextRunAt) : "—"} />
        <Meta label="Last run" value={automation.lastRunAt ? formatDate(automation.lastRunAt) : "—"} />
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="type-label">{label}</p>
      <p className="type-body mt-1">{value}</p>
    </div>
  );
}

function formatTrigger(trigger: AutomationTrigger): string {
  if (trigger.type === "manual") {
    return "manual";
  }

  return `schedule ${trigger.cron}${trigger.timezone ? ` (${trigger.timezone})` : ""}`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}
