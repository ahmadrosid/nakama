import type { SkillCuratorRunResult } from "@nakama/core/contract";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/context/use-auth";
import { client, formatError } from "@/lib/client";
import { toast } from "@/lib/toast";

function formatRunTime(value: string | null | undefined): string {
  if (!value) {
    return "Never";
  }

  const time = Date.parse(value);
  if (Number.isNaN(time)) {
    return "Never";
  }

  return new Date(time).toLocaleString();
}

function SkillsCuratorFreshnessClocks({
  activeOrg,
  busy,
  onUpdateFlag,
}: {
  activeOrg: NonNullable<ReturnType<typeof useAuth>["activeOrg"]>;
  busy: boolean;
  onUpdateFlag: (
    patch: Parameters<NonNullable<ReturnType<typeof useAuth>["updateOrg"]>>[1]
  ) => void;
}) {
  return (
    <div className="border-border border-b px-4 py-3">
      <p className="font-medium text-foreground text-sm">Freshness clocks</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="grid gap-1 text-muted-foreground text-xs">
          Stale after
          <input
            aria-label="Stale after days"
            className="h-8 rounded-md border border-input bg-background px-2 text-foreground text-sm"
            defaultValue={activeOrg.skillsCuratorStaleAfterDays ?? 30}
            disabled={busy}
            min={1}
            onBlur={(event) => {
              const value = event.currentTarget.valueAsNumber;
              if (Number.isInteger(value) && value >= 1) {
                onUpdateFlag({ skillsCuratorStaleAfterDays: value });
              }
            }}
            type="number"
          />
        </label>
        <label className="grid gap-1 text-muted-foreground text-xs">
          Archive after
          <input
            aria-label="Archive after days"
            className="h-8 rounded-md border border-input bg-background px-2 text-foreground text-sm"
            defaultValue={activeOrg.skillsCuratorArchiveAfterDays ?? 90}
            disabled={busy}
            max={3650}
            min={2}
            onBlur={(event) => {
              const value = event.currentTarget.valueAsNumber;
              if (Number.isInteger(value) && value >= 2) {
                onUpdateFlag({ skillsCuratorArchiveAfterDays: value });
              }
            }}
            type="number"
          />
        </label>
      </div>
    </div>
  );
}

function SkillsCuratorPollInterval({
  busy,
  pollIntervalMinutes,
  onBlur,
  onChange,
}: {
  busy: boolean;
  pollIntervalMinutes: number | null;
  onBlur: (value: number) => void;
  onChange: (value: number | null) => void;
}) {
  return (
    <div className="border-border border-b px-4 py-3">
      <label className="grid gap-1 text-muted-foreground text-xs">
        Automation worker poll interval (minutes)
        <input
          aria-label="Automation worker poll interval minutes"
          className="h-8 rounded-md border border-input bg-background px-2 text-foreground text-sm"
          disabled={busy || pollIntervalMinutes === null}
          max={1440}
          min={1}
          onBlur={(event) => {
            const value = event.currentTarget.valueAsNumber;
            if (Number.isInteger(value) && value >= 1) {
              onBlur(value);
            }
          }}
          onChange={(event) => {
            const value = event.currentTarget.valueAsNumber;
            onChange(Number.isFinite(value) ? value : null);
          }}
          type="number"
          value={pollIntervalMinutes ?? 5}
        />
      </label>
    </div>
  );
}

function SkillsCuratorRunSummary({
  latest,
  lastRunAt,
  orgLastRunAt,
  running,
  onRun,
}: {
  latest: SkillCuratorRunResult | null;
  lastRunAt: string | null;
  orgLastRunAt: string | null | undefined;
  running: boolean;
  onRun: (dryRun: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <p className="text-muted-foreground text-xs tabular-nums">
        {latest?.dryRun ? "Preview · " : null}
        Last run {formatRunTime(lastRunAt ?? orgLastRunAt)}
      </p>
      {latest ? (
        <p className="text-muted-foreground text-xs tabular-nums">
          Stale {latest.stale} · Archived {latest.archived} · Skipped{" "}
          {latest.skippedBundled +
            latest.skippedAutomation +
            latest.skippedTooNew +
            latest.skippedError}{" "}
          · Merged {latest.consolidateMerged ?? 0} · Deslop{" "}
          {latest.consolidateDeslopified ?? 0} · Staged{" "}
          {latest.consolidateStaged ?? 0} · Applied{" "}
          {latest.consolidateApplied ?? 0}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={running}
          onClick={() => void onRun(true)}
          size="sm"
          variant="outline"
        >
          Dry run
        </Button>
        <Button disabled={running} onClick={() => void onRun(false)} size="sm">
          Run now
        </Button>
        {running ? <Spinner /> : null}
      </div>
    </div>
  );
}

export function SkillsCuratorOrgCard() {
  const { activeOrg, updateOrg, user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [latest, setLatest] = useState<SkillCuratorRunResult | null>(null);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [pollIntervalMinutes, setPollIntervalMinutes] = useState<number | null>(
    null
  );

  const orgId = activeOrg?.id;

  const loadLatest = useCallback(async (id: string) => {
    const response = await client.getOrgSkillCuratorLatest(id);
    setLatest(response.result);
    setLastRunAt(response.lastRunAt);
  }, []);

  useEffect(() => {
    if (!orgId || activeOrg?.role !== "admin") {
      return;
    }

    void loadLatest(orgId).catch((error: unknown) => {
      toast(formatError(error));
    });
  }, [activeOrg?.role, loadLatest, orgId]);

  useEffect(() => {
    if (!orgId || user?.isPlatformAdmin !== true) {
      return;
    }

    void client
      .getAutomationWorkerSettings()
      .then((settings) => setPollIntervalMinutes(settings.pollIntervalMinutes))
      .catch((error: unknown) => toast(formatError(error)));
  }, [orgId, user?.isPlatformAdmin]);

  if (!activeOrg || activeOrg.role !== "admin") {
    return null;
  }

  const currentOrgId = activeOrg.id;
  const enabled = activeOrg.skillsCuratorEnabled === true;
  const consolidateEnabled = activeOrg.skillsCuratorConsolidateEnabled === true;

  async function updateOrgFlag(
    patch: Parameters<typeof updateOrg>[1]
  ): Promise<void> {
    setBusy(true);
    try {
      await updateOrg(currentOrgId, patch);
    } catch (error) {
      toast(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  async function updatePollInterval(value: number): Promise<void> {
    setBusy(true);
    try {
      const settings = await client.setAutomationWorkerSettings(value);
      setPollIntervalMinutes(settings.pollIntervalMinutes);
    } catch (error) {
      toast(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleRun(dryRun: boolean) {
    setRunning(true);
    try {
      const { result } = await client.runOrgSkillCurator(currentOrgId, {
        dryRun,
      });
      setLatest(result);
      if (!dryRun && result.status === "completed") {
        setLastRunAt(result.finishedAt);
      }
    } catch (error) {
      toast(formatError(error));
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card className="w-full overflow-hidden shadow-none">
      <div className="border-border border-b px-4 py-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-medium text-foreground text-sm">Skill curator</p>
          </div>
          <div className="flex shrink-0 items-center gap-2 pt-0.5">
            {busy ? <Spinner /> : null}
            <Switch
              aria-label="Enable skill curator"
              checked={enabled}
              disabled={busy}
              onCheckedChange={(checked) =>
                void updateOrgFlag({ skillsCuratorEnabled: checked })
              }
            />
          </div>
        </div>
      </div>
      <div className="border-border border-b px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <p className="text-foreground text-sm">Consolidate</p>
          <div className="flex shrink-0 items-center gap-2">
            {busy ? <Spinner /> : null}
            <Switch
              aria-label="Enable skill consolidate"
              checked={consolidateEnabled}
              disabled={busy || !enabled}
              onCheckedChange={(checked) =>
                void updateOrgFlag({
                  skillsCuratorConsolidateEnabled: checked,
                })
              }
            />
          </div>
        </div>
      </div>
      <SkillsCuratorFreshnessClocks
        activeOrg={activeOrg}
        busy={busy}
        onUpdateFlag={(patch) => void updateOrgFlag(patch)}
      />
      {user?.isPlatformAdmin === true ? (
        <SkillsCuratorPollInterval
          busy={busy}
          onBlur={(value) => void updatePollInterval(value)}
          onChange={setPollIntervalMinutes}
          pollIntervalMinutes={pollIntervalMinutes}
        />
      ) : null}
      <SkillsCuratorRunSummary
        lastRunAt={lastRunAt}
        latest={latest}
        onRun={handleRun}
        orgLastRunAt={activeOrg.skillsCuratorLastRunAt}
        running={running}
      />
    </Card>
  );
}
