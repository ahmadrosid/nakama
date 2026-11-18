import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  AutomationRunRecord,
  AutomationToolLimit,
  StoredAutomation,
} from "@nakama/core";
import { isAutomationRunUnread, NakamaApiError } from "@nakama/core";
import type { DatabaseAdapter } from "@nakama/db";
import { z } from "zod";

const DeliveryStatusSchema = z.enum(["sent", "failed", "skipped"]).nullish();

const WEBHOOK_SIGNATURE_PATTERN = /^sha256=([0-9a-f]{64})$/;

/** The hex digest of a GitHub-style `X-Hub-Signature-256` header. */
export function webhookSignatureHex(
  header: string | undefined
): string | undefined {
  return WEBHOOK_SIGNATURE_PATTERN.exec(header ?? "")?.[1];
}

export function webhookSignatureMatches(
  secret: string,
  body: Uint8Array,
  hex: string
): boolean {
  const expected = createHmac("sha256", secret).update(body).digest();
  const received = Buffer.from(hex, "hex");

  // The pattern fixes the length, so timingSafeEqual cannot throw here.
  return timingSafeEqual(expected, received);
}

export function automationBelongsToOrg(
  automation: StoredAutomation,
  orgId: string
): boolean {
  return automation.orgId === orgId;
}

/** Refuses a save made from an older copy; no version skips the check. */
export function assertAutomationVersion(
  automation: StoredAutomation,
  version?: number
): void {
  if (version !== undefined && version !== automation.version) {
    throw new NakamaApiError(
      "This automation changed after you opened it. Open it again to edit.",
      409
    );
  }
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
  orgId: string,
  profileId: string,
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

  // listMcpServersForProfile leaves out a server that is switched off. Keep
  // one the agent still has, so it works again when it is switched back on.
  if (clean.mcpServerIds.some((id) => !serverIds.has(id))) {
    const asked = new Set(clean.mcpServerIds);

    const off = (await db.listMcpServers()).filter(
      (server) => !server.enabled && asked.has(server.id)
    );

    await Promise.all(
      off.map(async ({ id }) => {
        const profiles = await db.listProfilesForMcpServer(id);

        if (profiles.some((profile) => profile.id === sourceId)) {
          serverIds.add(id);
        }
      })
    );
  }

  return {
    composioToolkits: clean.composioToolkits.filter((slug) => slugs.has(slug)),
    mcpServerIds: clean.mcpServerIds.filter((id) => serverIds.has(id)),
    toolIds: clean.toolIds.filter((id) => toolIds.has(id)),
  };
}

/**
 * The limit an update stores, and whether the caller changed it. A stored
 * limit moves to a new agent scoped to that agent. A resend of the stored
 * limit that only loses stale ids is not a change by the caller.
 */
export async function updatedToolLimit(
  db: DatabaseAdapter,
  orgId: string,
  profileId: string,
  existing: StoredAutomation,
  input: AutomationToolLimit | null | undefined
): Promise<{ changed: boolean; toolLimit?: AutomationToolLimit }> {
  const stored = existing.toolLimit;

  if (input === null) {
    return { changed: Boolean(stored) };
  }

  const requested = input ?? stored;

  if (!requested || (!input && profileId === existing.profileId)) {
    return { changed: false, toolLimit: stored };
  }

  const toolLimit = await scopeToolLimit(db, orgId, profileId, requested);
  const same = (limit: AutomationToolLimit) =>
    JSON.stringify(limit) === JSON.stringify(stored);

  return {
    changed:
      Boolean(input) &&
      !same(toolLimit) &&
      !same(normalizeToolLimit(requested)),
    toolLimit,
  };
}
