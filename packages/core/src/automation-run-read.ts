import type { AutomationRunRecord } from "./contract";

export const AUTOMATION_RUN_READ_EPOCH = "1970-01-01T00:00:00.000Z";

export function isAutomationRunUnread(
  run: Pick<AutomationRunRecord, "status" | "completedAt" | "startedAt">,
  readThroughAt: string | null | undefined,
): boolean {
  if (run.status === "running") {
    return false;
  }

  const watermark = readThroughAt ?? AUTOMATION_RUN_READ_EPOCH;
  const timestamp = run.completedAt ?? run.startedAt;
  return timestamp > watermark;
}

export function summarizeAutomationUnreadCounts(
  counts: Array<{ automationId: string; unreadCount: number }>,
): { totalUnread: number; byAutomationId: Record<string, number> } {
  const byAutomationId: Record<string, number> = {};
  let totalUnread = 0;

  for (const entry of counts) {
    if (entry.unreadCount <= 0) {
      continue;
    }

    byAutomationId[entry.automationId] = entry.unreadCount;
    totalUnread += entry.unreadCount;
  }

  return { totalUnread, byAutomationId };
}
