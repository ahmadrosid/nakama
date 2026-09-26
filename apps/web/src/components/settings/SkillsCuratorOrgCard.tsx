import type {
  SkillCuratorRunResult,
  UpdateOrganizationRequest,
} from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import { Card } from "@nakama/ui/card";
import { Spinner } from "@nakama/ui/spinner";
import { Switch } from "@nakama/ui/switch";
import { toast } from "@nakama/ui/toast";
import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";
import type { AuthContextValue } from "@/context/auth-context-shared";
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

type SkillsCuratorRunState = {
  lastRunAt: string | null;
  latest: SkillCuratorRunResult | null;
  orgId: string;
};

type PollIntervalState = {
  orgId: string;
  value: number | null;
};

async function updateOrgFlag(
  updateOrg: AuthContextValue["updateOrg"],
  orgId: string,
  patch: UpdateOrganizationRequest,
  setBusyOrgId: Dispatch<SetStateAction<string | null>>
): Promise<void> {
  setBusyOrgId(orgId);
  try {
    await updateOrg(orgId, patch);
  } catch (error) {
    toast(formatError(error));
  } finally {
    setBusyOrgId((busyOrgId) => (busyOrgId === orgId ? null : busyOrgId));
  }
}

async function updatePollInterval(
  value: number,
  orgId: string,
  setBusyOrgId: Dispatch<SetStateAction<string | null>>,
  setPollIntervalState: Dispatch<SetStateAction<PollIntervalState | null>>
): Promise<void> {
  setBusyOrgId(orgId);
  try {
    const settings = await client.setAutomationWorkerSettings(value);
    setPollIntervalState({ orgId, value: settings.pollIntervalMinutes });
  } catch (error) {
    toast(formatError(error));
  } finally {
    setBusyOrgId((busyOrgId) => (busyOrgId === orgId ? null : busyOrgId));
  }
}

async function runSkillCurator(
  orgId: string,
  dryRun: boolean,
  isCurrentRequest: () => boolean,
  setRunningOrgId: Dispatch<SetStateAction<string | null>>,
  setRunState: Dispatch<SetStateAction<SkillsCuratorRunState | null>>
): Promise<void> {
  setRunningOrgId(orgId);
  try {
    const { result } = await client.runOrgSkillCurator(orgId, { dryRun });
    if (!isCurrentRequest()) {
      return;
    }
    setRunState((current) => ({
      lastRunAt:
        !dryRun && result.status === "completed"
          ? result.finishedAt
          : current?.orgId === orgId
            ? current.lastRunAt
            : null,
      latest: result,
      orgId,
    }));
  } catch (error) {
    if (isCurrentRequest()) {
      toast(formatError(error));
    }
  } finally {
    if (isCurrentRequest()) {
      setRunningOrgId((runningOrgId) =>
        runningOrgId === orgId ? null : runningOrgId
      );
    }
  }
}

function useSkillsCuratorOrgCard() {
  const { activeOrg, updateOrg, user } = useAuth();
  const latestRequestRef = useRef(0);
  const pollRequestRef = useRef(0);
  const runRequestRef = useRef(0);
  const [busyOrgId, setBusyOrgId] = useState<string | null>(null);
  const [runningOrgId, setRunningOrgId] = useState<string | null>(null);
  const [runState, setRunState] = useState<SkillsCuratorRunState | null>(null);
  const [pollIntervalState, setPollIntervalState] =
    useState<PollIntervalState | null>(null);

  const orgId = activeOrg?.id;
  const latest = runState?.orgId === orgId ? runState.latest : null;
  const lastRunAt = runState?.orgId === orgId ? runState.lastRunAt : null;
  const pollIntervalMinutes =
    pollIntervalState?.orgId === orgId ? pollIntervalState.value : null;

  useEffect(() => {
    const requestId = ++latestRequestRef.current;
    const currentRequestId = ++runRequestRef.current;
    if (!orgId || activeOrg?.role !== "admin") {
      return;
    }

    void client
      .getOrgSkillCuratorLatest(orgId)
      .then((response) => {
        if (latestRequestRef.current !== requestId) {
          return;
        }
        setRunState({
          lastRunAt: response.lastRunAt,
          latest: response.result,
          orgId,
        });
      })
      .catch((error: unknown) => {
        if (latestRequestRef.current === requestId) {
          toast(formatError(error));
        }
      });

    return () => {
      if (runRequestRef.current === currentRequestId) {
        runRequestRef.current += 1;
      }
    };
  }, [activeOrg?.role, orgId]);

  useEffect(() => {
    const requestId = ++pollRequestRef.current;
    if (!orgId || user?.isPlatformAdmin !== true) {
      return;
    }

    void client
      .getAutomationWorkerSettings()
      .then((settings) => {
        if (pollRequestRef.current === requestId) {
          setPollIntervalState({ orgId, value: settings.pollIntervalMinutes });
        }
      })
      .catch((error: unknown) => {
        if (pollRequestRef.current === requestId) {
          toast(formatError(error));
        }
      });
  }, [orgId, user?.isPlatformAdmin]);

  return {
    activeOrg,
    busy: busyOrgId === orgId,
    lastRunAt,
    latest,
    pollIntervalMinutes,
    running: runningOrgId === orgId,
    runRequestRef,
    setBusyOrgId,
    setPollIntervalState,
    setRunningOrgId,
    setRunState,
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
    runRequestRef,
    setBusyOrgId,
    setPollIntervalState,
    setRunState,
    setRunningOrgId,
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
                  setBusyOrgId
                )
              }
              size="sm"
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
                  setBusyOrgId
                )
              }
              size="sm"
            />
          </div>
        </div>
      </div>
      <SkillsCuratorFreshnessFields
        archiveAfterDays={activeOrg.skillsCuratorArchiveAfterDays ?? 90}
        busy={busy}
        onUpdateFlag={(patch) =>
          void updateOrgFlag(updateOrg, currentOrgId, patch, setBusyOrgId)
        }
        staleAfterDays={activeOrg.skillsCuratorStaleAfterDays ?? 30}
      />
      {user?.isPlatformAdmin === true ? (
        <SkillsCuratorPollIntervalField
          busy={busy}
          onPollIntervalChange={(value) =>
            setPollIntervalState({ orgId: currentOrgId, value })
          }
          onPollIntervalCommit={(value) =>
            void updatePollInterval(
              value,
              currentOrgId,
              setBusyOrgId,
              setPollIntervalState
            )
          }
          pollIntervalMinutes={pollIntervalMinutes}
        />
      ) : null}
      <SkillsCuratorRunSection
        lastRunLabel={formatRunTime(
          lastRunAt ?? activeOrg.skillsCuratorLastRunAt
        )}
        latest={latest}
        onRun={(dryRun) => {
          const requestId = ++runRequestRef.current;
          void runSkillCurator(
            currentOrgId,
            dryRun,
            () => runRequestRef.current === requestId,
            setRunningOrgId,
            setRunState
          );
        }}
        running={running}
      />
    </Card>
  );
}
