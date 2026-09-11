import type { SkillCuratorRunResult } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import { Card } from "@nakama/ui/card";
import { Spinner } from "@nakama/ui/spinner";
import { Switch } from "@nakama/ui/switch";
import { toast } from "@nakama/ui/toast";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/context/use-auth";
import { client, formatError } from "@/lib/client";

function parseIntegerInput(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

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

async function updateOrgFlag(
  updateOrg: ReturnType<typeof useAuth>["updateOrg"],
  orgId: string,
  patch: Parameters<ReturnType<typeof useAuth>["updateOrg"]>[1],
  setBusy: (value: boolean) => void
): Promise<void> {
  setBusy(true);
  try {
    await updateOrg(orgId, patch);
  } catch (error) {
    toast(formatError(error));
  } finally {
    setBusy(false);
  }
}

async function updatePollInterval(
  value: number,
  setBusy: (busy: boolean) => void,
  setPollIntervalMinutes: (value: number | null) => void
): Promise<void> {
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

async function runSkillCurator(
  orgId: string,
  dryRun: boolean,
  setRunning: (value: boolean) => void,
  setLatest: (value: SkillCuratorRunResult | null) => void,
  setLastRunAt: (value: string | null) => void
): Promise<void> {
  setRunning(true);
  try {
    const { result } = await client.runOrgSkillCurator(orgId, { dryRun });
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

function loadSkillsCuratorLatest(
  orgId: string | undefined,
  role: string | undefined,
  loadLatest: (id: string) => Promise<void>
) {
  if (!orgId || role !== "admin") {
    return;
  }

  void loadLatest(orgId).catch((error: unknown) => {
    toast(formatError(error));
  });
}

function loadAutomationPollInterval(
  orgId: string | undefined,
  isPlatformAdmin: boolean | undefined,
  setPollIntervalMinutes: (value: number | null) => void
) {
  if (!orgId || isPlatformAdmin !== true) {
    return;
  }

  void client
    .getAutomationWorkerSettings()
    .then((settings) => setPollIntervalMinutes(settings.pollIntervalMinutes))
    .catch((error: unknown) => toast(formatError(error)));
}

function useSkillsCuratorOrgCard() {
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
    loadSkillsCuratorLatest(orgId, activeOrg?.role, loadLatest);
  }, [activeOrg?.role, loadLatest, orgId]);

  useEffect(() => {
    loadAutomationPollInterval(
      orgId,
      user?.isPlatformAdmin,
      setPollIntervalMinutes
    );
  }, [orgId, user?.isPlatformAdmin]);

  return {
    activeOrg,
    busy,
    lastRunAt,
    latest,
    pollIntervalMinutes,
    running,
    setBusy,
    setLastRunAt,
    setLatest,
    setPollIntervalMinutes,
    setRunning,
    updateOrg,
    user,
  };
}

function SkillsCuratorFreshnessFields({
  busy,
  staleAfterDays,
  archiveAfterDays,
  onUpdateFlag,
}: {
  busy: boolean;
  staleAfterDays: number;
  archiveAfterDays: number;
  onUpdateFlag: (
    patch: Parameters<ReturnType<typeof useAuth>["updateOrg"]>[1]
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
            defaultValue={staleAfterDays}
            disabled={busy}
            min={1}
            onBlur={(event) => {
              const value = parseIntegerInput(event.currentTarget.value);
              if (value !== undefined) {
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
            defaultValue={archiveAfterDays}
            disabled={busy}
            max={3650}
            min={2}
            onBlur={(event) => {
              const value = parseIntegerInput(event.currentTarget.value);
              if (value !== undefined) {
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

function SkillsCuratorPollIntervalField({
  busy,
  pollIntervalMinutes,
  onPollIntervalChange,
  onPollIntervalCommit,
}: {
  busy: boolean;
  pollIntervalMinutes: number | null;
  onPollIntervalChange: (value: number) => void;
  onPollIntervalCommit: (value: number) => void;
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
            const value = parseIntegerInput(event.currentTarget.value);
            if (value !== undefined) {
              onPollIntervalCommit(value);
            }
          }}
          onChange={(event) => {
            const value = event.currentTarget.valueAsNumber;
            if (Number.isFinite(value)) {
              onPollIntervalChange(value);
            }
          }}
          type="number"
          value={pollIntervalMinutes ?? 5}
        />
      </label>
    </div>
  );
}

function SkillsCuratorRunSection({
  latest,
  lastRunLabel,
  running,
  onRun,
}: {
  latest: SkillCuratorRunResult | null;
  lastRunLabel: string;
  running: boolean;
  onRun: (dryRun: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <p className="text-muted-foreground text-xs tabular-nums">
        {latest?.dryRun ? "Preview · " : null}
        Last run {lastRunLabel}
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
          onClick={() => onRun(true)}
          size="sm"
          variant="outline"
        >
          Dry run
        </Button>
        <Button disabled={running} onClick={() => onRun(false)} size="sm">
          Run now
        </Button>
        {running ? <Spinner /> : null}
      </div>
    </div>
  );
}

export function SkillsCuratorOrgCard() {
  const {
    activeOrg,
    busy,
    lastRunAt,
    latest,
    pollIntervalMinutes,
    running,
    setBusy,
    setLastRunAt,
    setLatest,
    setPollIntervalMinutes,
    setRunning,
    updateOrg,
    user,
  } = useSkillsCuratorOrgCard();

  if (!activeOrg || activeOrg.role !== "admin") {
    return null;
  }

  const currentOrgId = activeOrg.id;
  const enabled = activeOrg.skillsCuratorEnabled === true;
  const consolidateEnabled = activeOrg.skillsCuratorConsolidateEnabled === true;

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
                void updateOrgFlag(
                  updateOrg,
                  currentOrgId,
                  {
                    skillsCuratorEnabled: checked,
                  },
                  setBusy
                )
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
                void updateOrgFlag(
                  updateOrg,
                  currentOrgId,
                  {
                    skillsCuratorConsolidateEnabled: checked,
                  },
                  setBusy
                )
              }
            />
          </div>
        </div>
      </div>
      <SkillsCuratorFreshnessFields
        archiveAfterDays={activeOrg.skillsCuratorArchiveAfterDays ?? 90}
        busy={busy}
        onUpdateFlag={(patch) =>
          void updateOrgFlag(updateOrg, currentOrgId, patch, setBusy)
        }
        staleAfterDays={activeOrg.skillsCuratorStaleAfterDays ?? 30}
      />
      {user?.isPlatformAdmin === true ? (
        <SkillsCuratorPollIntervalField
          busy={busy}
          onPollIntervalChange={setPollIntervalMinutes}
          onPollIntervalCommit={(value) =>
            void updatePollInterval(value, setBusy, setPollIntervalMinutes)
          }
          pollIntervalMinutes={pollIntervalMinutes}
        />
      ) : null}
      <SkillsCuratorRunSection
        lastRunLabel={formatRunTime(
          lastRunAt ?? activeOrg.skillsCuratorLastRunAt
        )}
        latest={latest}
        onRun={(dryRun) =>
          void runSkillCurator(
            currentOrgId,
            dryRun,
            setRunning,
            setLatest,
            setLastRunAt
          )
        }
        running={running}
      />
    </Card>
  );
}
