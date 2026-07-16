import type {
  AutomationDeliveryStatus,
  AutomationRunRecord,
  AutomationTrigger,
  AutomationUnreadSummary,
  CreateAutomationRequest,
  StoredAutomation,
  UpdateAutomationRequest,
} from "@nakama/core";
import {
  computeAutomationNextRunAt,
  createId,
  DEFAULT_TIMEZONE,
  isAutomationRunUnread,
  isWorkerSchedulable,
  NakamaApiError,
  normalizeAutomationDelivery,
  resolveScheduleTimezone,
  summarizeAutomationUnreadCounts,
  validateAutomationDelivery,
  validateAutomationInput,
} from "@nakama/core";
import { canAccessSuperBotProfile } from "@nakama/core/profiles";
import { DatabaseAutomationStore, type DatabaseAdapter } from "@nakama/db";

/** Caller role context used to gate access to admin-only profiles (e.g. Super Bot). */
export type ProfileAccess = Parameters<typeof canAccessSuperBotProfile>[0];

export interface AutomationServiceOptions {
  getUserTimezone: () => Promise<string>;
  canSendEmail?: (profileId: string, orgId: string) => Promise<boolean>;
  onChange?: () => void | Promise<void>;
}

export class AutomationService {
  private readonly store: DatabaseAutomationStore;
  private readonly db: DatabaseAdapter;
  private readonly getUserTimezone: () => Promise<string>;
  private readonly canSendEmail?: (profileId: string, orgId: string) => Promise<boolean>;
  private onChange?: () => void | Promise<void>;

  constructor(db: DatabaseAdapter, options: AutomationServiceOptions) {
    this.db = db;
    this.store = new DatabaseAutomationStore(db);
    this.getUserTimezone = options.getUserTimezone;
    this.canSendEmail = options.canSendEmail;
    this.onChange = options.onChange;
  }

  setOnChange(onChange: () => void | Promise<void>): void {
    this.onChange = onChange;
  }

  /** All automations — used by the scheduler across orgs. */
  async listAll(): Promise<StoredAutomation[]> {
    const automations = await this.store.list();
    return Promise.all(automations.map((automation) => this.enrichAutomation(automation)));
  }

  async listForOrg(orgId: string, userId?: string): Promise<{
    automations: StoredAutomation[];
    unread?: AutomationUnreadSummary;
  }> {
    const automations = await this.store.listForOrg(orgId);
    const enriched = await Promise.all(
      automations.map((automation) => this.enrichAutomation(automation)),
    );
    const unread = userId ? await this.getUnreadSummary(orgId, userId) : undefined;

    return { automations: enriched, unread };
  }

  async get(id: string, orgId?: string): Promise<StoredAutomation | null> {
    const automation = await this.store.get(id);
    if (!automation || (orgId && !automationBelongsToOrg(automation, orgId))) {
      return null;
    }

    return this.enrichAutomation(automation);
  }

  async create(
    orgId: string,
    input: CreateAutomationRequest,
    profileIdOverride?: string,
    access?: ProfileAccess,
  ): Promise<StoredAutomation> {
    const userTimezone = await this.getUserTimezone();
    const trigger = resolveScheduleTimezone(input.trigger, userTimezone);

    validateAutomationInput({
      name: input.name,
      prompt: input.prompt,
      trigger,
    });

    const profileId = await this.resolveProfileId(
      orgId,
      profileIdOverride ?? input.profileId,
      access,
    );
    const delivery = normalizeAutomationDelivery(input.delivery);
    await validateAutomationDelivery(delivery, {
      isEmailConfigured: this.canSendEmail
        ? () => this.canSendEmail!(profileId, orgId)
        : undefined,
    });

    const now = new Date().toISOString();
    const automation: StoredAutomation = {
      id: createId("automation"),
      name: input.name.trim(),
      description: input.description.trim() || input.prompt.trim(),
      prompt: input.prompt.trim(),
      trigger,
      steps: [],
      version: 1,
      profileId,
      orgId,
      enabled: input.enabled ?? true,
      ...(delivery ? { delivery } : {}),
      createdAt: now,
      updatedAt: now,
    };

    await this.store.save(automation);
    await this.notifyChange();
    return this.enrichAutomation(automation);
  }

  async update(
    id: string,
    orgId: string,
    input: UpdateAutomationRequest,
  ): Promise<StoredAutomation> {
    const existing = await this.get(id, orgId);

    if (!existing) {
      throw new Error("Automation not found.");
    }

    const userTimezone = await this.getUserTimezone();
    const trigger = input.trigger
      ? resolveScheduleTimezone(input.trigger, userTimezone)
      : existing.trigger;

    validateAutomationInput({
      name: input.name?.trim() || existing.name,
      prompt: input.prompt?.trim() || existing.prompt,
      trigger,
    });

    let delivery = existing.delivery;

    if (input.delivery === null) {
      delivery = undefined;
    } else if (input.delivery !== undefined) {
      delivery = normalizeAutomationDelivery(input.delivery);
    }

    await validateAutomationDelivery(delivery, {
      isEmailConfigured: this.canSendEmail
        ? () => this.canSendEmail!(existing.profileId, orgId)
        : undefined,
    });

    const updated: StoredAutomation = {
      ...existing,
      name: input.name?.trim() || existing.name,
      description: input.description?.trim() ?? existing.description,
      prompt: input.prompt?.trim() || existing.prompt,
      trigger,
      enabled: input.enabled ?? existing.enabled,
      delivery,
      version: existing.version + 1,
      updatedAt: new Date().toISOString(),
    };

    await this.store.save(updated);
    await this.notifyChange();
    return this.enrichAutomation(updated);
  }

  async delete(id: string, orgId: string): Promise<boolean> {
    const existing = await this.get(id, orgId);
    if (!existing) {
      return false;
    }

    const deleted = await this.store.delete(id);

    if (deleted) {
      await this.notifyChange();
    }

    return deleted;
  }

  async listRuns(
    automationId: string,
    orgId?: string,
    limit = 20,
    userId?: string,
  ): Promise<AutomationRunRecord[]> {
    const automation = orgId
      ? await this.get(automationId, orgId)
      : await this.store.get(automationId);

    if (!automation) {
      throw new Error("Automation not found.");
    }

    const runs = await this.db.listAutomationRuns(automationId, limit);
    const readThroughAt =
      userId && orgId
        ? await this.db.getAutomationRunReadThrough(userId, orgId, automationId)
        : null;

    return runs.map((run) => toRunRecord(run, readThroughAt));
  }

  async deleteRun(automationId: string, runId: string, orgId: string): Promise<boolean> {
    const automation = await this.get(automationId, orgId);

    if (!automation) {
      throw new Error("Automation not found.");
    }

    return this.db.deleteAutomationRun(automationId, runId);
  }

  async markRunsRead(
    automationId: string,
    orgId: string,
    userId: string,
  ): Promise<{ readThroughAt: string }> {
    const automation = await this.get(automationId, orgId);

    if (!automation) {
      throw new Error("Automation not found.");
    }

    const readThroughAt = new Date().toISOString();
    await this.db.upsertAutomationRunReadThrough(userId, orgId, automationId, readThroughAt);
    return { readThroughAt };
  }

  async getUnreadSummary(orgId: string, userId: string): Promise<AutomationUnreadSummary> {
    const counts = await this.db.countUnreadAutomationRunsByOrg(userId, orgId);
    return summarizeAutomationUnreadCounts(counts);
  }

  async getActiveRun(automationId: string): Promise<AutomationRunRecord | null> {
    const run = await this.db.getActiveAutomationRun(automationId);
    return run ? toRunRecord(run) : null;
  }

  async createRun(automationId: string): Promise<AutomationRunRecord> {
    const run = {
      id: createId("run"),
      automationId,
      status: "running" as const,
      startedAt: new Date().toISOString(),
      completedAt: null,
      output: null,
      error: null,
    };

    await this.db.insertAutomationRun(run);
    return toRunRecord(run);
  }

  async completeRun(
    runId: string,
    automationId: string,
    result: { output?: string; error?: string },
  ): Promise<AutomationRunRecord> {
    const active = await this.db.getActiveAutomationRun(automationId);
    const run = active?.id === runId ? active : null;

    if (!run) {
      throw new Error("Automation run not found.");
    }

    const updated = {
      ...run,
      status: result.error ? ("failed" as const) : ("completed" as const),
      completedAt: new Date().toISOString(),
      output: result.output ?? null,
      error: result.error ?? null,
    };

    await this.db.updateAutomationRun(updated);
    return toRunRecord(updated);
  }

  async updateRunDelivery(
    runId: string,
    automationId: string,
    result: {
      deliveryStatus: AutomationDeliveryStatus;
      deliveryError: string | null;
    },
  ): Promise<AutomationRunRecord> {
    const runs = await this.db.listAutomationRuns(automationId, 100);
    const run = runs.find((entry) => entry.id === runId);

    if (!run) {
      throw new Error("Automation run not found.");
    }

    const updated = {
      ...run,
      deliveryStatus: result.deliveryStatus,
      deliveryError: result.deliveryError,
    };

    await this.db.updateAutomationRun(updated);
    return toRunRecord(updated);
  }

  computeNextRunAt(
    trigger: AutomationTrigger,
    userTimezone = DEFAULT_TIMEZONE,
  ): string | null {
    return computeAutomationNextRunAt(trigger, userTimezone);
  }

  private async resolveProfileId(
    orgId: string,
    profileId?: string,
    access?: ProfileAccess,
  ): Promise<string> {
    const trimmed = profileId?.trim();

    if (trimmed) {
      const profile = await this.db.getProfileForOrg(trimmed, orgId);
      if (profile) {
        if (profile.isSuper && access && !canAccessSuperBotProfile(access)) {
          throw new NakamaApiError("Super Bot is only available to org admins.", 403);
        }
        return profile.id;
      }

      throw new Error("Profile not found.");
    }

    const defaultProfile = await this.db.getDefaultProfileForOrg(orgId);
    if (!defaultProfile) {
      throw new Error("No default profile exists for this organization.");
    }

    return defaultProfile.id;
  }

  private async enrichAutomation(automation: StoredAutomation): Promise<StoredAutomation> {
    const userTimezone = await this.getUserTimezone();
    const runs = await this.db.listAutomationRuns(automation.id, 1);

    return {
      ...automation,
      nextRunAt: isWorkerSchedulable(automation)
        ? this.computeNextRunAt(automation.trigger, userTimezone)
        : null,
      lastRunAt: runs[0]?.startedAt ?? null,
    };
  }

  private async notifyChange(): Promise<void> {
    await this.onChange?.();
  }
}

function automationBelongsToOrg(automation: StoredAutomation, orgId: string): boolean {
  return automation.orgId === orgId;
}

function toRunRecord(
  run: {
    id: string;
    automationId: string;
    status: AutomationRunRecord["status"];
    startedAt: string;
    completedAt: string | null;
    output: string | null;
    error: string | null;
    deliveryStatus?: string | null;
    deliveryError?: string | null;
  },
  readThroughAt?: string | null,
): AutomationRunRecord {
  const record: AutomationRunRecord = {
    id: run.id,
    automationId: run.automationId,
    status: run.status,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    output: run.output,
    error: run.error,
    deliveryStatus: (run.deliveryStatus as AutomationRunRecord["deliveryStatus"]) ?? null,
    deliveryError: run.deliveryError ?? null,
  };

  if (readThroughAt !== undefined) {
    record.read = !isAutomationRunUnread(record, readThroughAt);
  }

  return record;
}
