import { reportInvariant } from "@nakama/core/crash-report";
import type { DatabaseAdapter, StoredAutomationRunRecord } from "@nakama/db";

/**
 * An automation run lives entirely inside one server process: AutomationRunner completes
 * it in a finally block, so the only way a row stays "running" is the process dying
 * mid-run. A row that says running but started before this process booted therefore
 * cannot be running, and the user is looking at an automation that silently never
 * finished. Nothing throws in that case, which is why it needs its own check.
 */
export async function reconcileOrphanedAutomationRuns(
  databaseAdapter: DatabaseAdapter,
  processStartedAtMs: number
): Promise<StoredAutomationRunRecord[]> {
  const automations = await databaseAdapter.listAutomations();
  const orphaned: StoredAutomationRunRecord[] = [];

  // ponytail: one active-run lookup per automation. Fine at self-host scale; a dedicated
  // "list runs by status" query is the upgrade if an install ever has thousands.
  for (const automation of automations) {
    const run = await databaseAdapter.getActiveAutomationRun(automation.id);

    if (!run) {
      continue;
    }

    const startedAt = Date.parse(run.startedAt);

    if (!Number.isFinite(startedAt) || startedAt >= processStartedAtMs) {
      continue;
    }

    orphaned.push(run);
  }

  if (orphaned.length === 0) {
    return orphaned;
  }

  // Marked failed rather than left alone: a row that cannot be running should not claim to
  // be, and without this the same runs would be reported again on every restart forever.
  const completedAt = new Date().toISOString();

  for (const run of orphaned) {
    await databaseAdapter.updateAutomationRun({
      ...run,
      completedAt,
      error: "The server stopped before this run finished.",
      status: "failed",
    });
  }

  void reportInvariant(
    `${orphaned.length} automation runs were left unfinished by a previous server process`,
    { source: "server" }
  );

  return orphaned;
}
