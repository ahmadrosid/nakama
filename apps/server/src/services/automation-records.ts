import type {
  AutomationRunRecord,
  AutomationToolLimit,
  StoredAutomation,
} from "@nakama/core";
import { isAutomationRunUnread } from "@nakama/core";
import type { DatabaseAdapter } from "@nakama/db";
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

function normalizeToolLimit(limit: AutomationToolLimit): AutomationToolLimit {
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

/**
 * Keeps only the ids the automation's agent has, so a stale id cannot turn on
 * when the agent gains that tool later. Unknown ids drop silently: the form
 * sends the old selection back after the agent loses a tool.
 */
export async function scopeToolLimit(
  db: DatabaseAdapter,
  { orgId, profileId }: Pick<StoredAutomation, "orgId" | "profileId">,
  limit: AutomationToolLimit
): Promise<AutomationToolLimit> {
  const clean = normalizeToolLimit(limit);

  // A shared agent runs its source's tools and MCP servers, as in
  // resolveProfileTools. Composio toolkits stay on the team's profile.
  const instance = await db.getSharedAgentInstance(orgId, profileId);

  const sourceId = instance?.sourceProfileId ?? profileId;

  const [tools, servers, assignments, toolkits] = await Promise.all([
    db.listToolsForProfile(sourceId),
    db.listMcpServersForProfile(sourceId),
    db.listProfileComposioToolkits(profileId),
    db.listComposioToolkitsForOrg(orgId),
  ]);

  const toolIds = new Set(tools.map((tool) => tool.id));

  const serverIds = new Set(servers.map((server) => server.id));

  const assigned = new Set(assignments.map((item) => item.toolkitId));

  const slugs = new Set(
    toolkits
      .filter((toolkit) => assigned.has(toolkit.id))
      .map((toolkit) => toolkit.toolkitSlug.toLowerCase())
  );

  return {
    composioToolkits: clean.composioToolkits.filter((slug) => slugs.has(slug)),
    mcpServerIds: clean.mcpServerIds.filter((id) => serverIds.has(id)),
    toolIds: clean.toolIds.filter((id) => toolIds.has(id)),
  };
}
