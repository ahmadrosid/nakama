import type {
  AutomationRunRecord,
  AutomationToolLimit,
  StoredAutomation,
} from "@nakama/core";
import { isAutomationRunUnread } from "@nakama/core";
import { z } from "zod";

const DeliveryStatusSchema = z.enum(["sent", "failed", "skipped"]).nullish();

export function automationBelongsToOrg(
  automation: StoredAutomation,
  orgId: string
): boolean {
  return automation.orgId === orgId;
}

export function toRunRecord(
  run: {
    id: string;
    automationId: string;
    status: AutomationRunRecord["status"];
    startedAt: string;
    completedAt: string | null;
    output: string | null;
    progress?: AutomationRunRecord["progress"];
    error: string | null;
    deliveryStatus?: string | null;
    deliveryError?: string | null;
    source?: "webhook" | null;
  },
  readThroughAt?: string | null
): AutomationRunRecord {
  const record: AutomationRunRecord = {
    automationId: run.automationId,
    completedAt: run.completedAt,
    deliveryError: run.deliveryError ?? null,
    deliveryStatus: DeliveryStatusSchema.parse(run.deliveryStatus) ?? null,
    error: run.error,
    id: run.id,
    output: run.output,
    progress: run.progress,
    startedAt: run.startedAt,
    status: run.status,
  };

  if (run.source === "webhook") {
    record.source = "webhook";
  }

  if (readThroughAt !== undefined) {
    record.read = !isAutomationRunUnread(record, readThroughAt);
  }

  return record;
}

export function normalizeToolLimit(
  limit: AutomationToolLimit
): AutomationToolLimit {
  const clean = (ids: string[]) => [
    ...new Set(ids.flatMap((id) => id.trim() || [])),
  ];

  return {
    composioToolkits: clean(
      limit.composioToolkits.map((slug) => slug.toLowerCase())
    ),
    mcpServerIds: clean(limit.mcpServerIds),
    toolIds: clean(limit.toolIds),
  };
}
