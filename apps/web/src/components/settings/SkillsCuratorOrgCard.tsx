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

export function SkillsCuratorOrgCard() {
  const { activeOrg, updateOrg } = useAuth();
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [latest, setLatest] = useState<SkillCuratorRunResult | null>(null);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);

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
        <div className="flex items-center justify-between gap-4">
          <p className="font-medium text-foreground text-sm">Skill curator</p>
          <div className="flex shrink-0 items-center gap-2">
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
      <div className="flex flex-col gap-3 px-4 py-3">
        <p className="text-muted-foreground text-xs tabular-nums">
          {latest?.dryRun ? "Preview · " : null}
          Last run{" "}
          {formatRunTime(lastRunAt ?? activeOrg.skillsCuratorLastRunAt)}
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
            onClick={() => void handleRun(true)}
            size="sm"
            variant="outline"
          >
            Dry run
          </Button>
          <Button
            disabled={running}
            onClick={() => void handleRun(false)}
            size="sm"
          >
            Run now
          </Button>
          {running ? <Spinner /> : null}
        </div>
      </div>
    </Card>
  );
}
