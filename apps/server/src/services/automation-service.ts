import type {
  AutomationRunRecord,
  AutomationTrigger,
  CreateAutomationRequest,
  StoredAutomation,
  UpdateAutomationRequest,
} from "@tinyclaw/core";
import {
  computeAutomationNextRunAt,
  createId,
  DEFAULT_TIMEZONE,
  isWorkerSchedulable,
  resolveScheduleTimezone,
  validateAutomationInput,
} from "@tinyclaw/core";
import { DatabaseAutomationStore, type DatabaseAdapter } from "@tinyclaw/db";

export interface AutomationServiceOptions {
  getUserTimezone: () => Promise<string>;
  onChange?: () => void | Promise<void>;
}

export class AutomationService {
  private readonly store: DatabaseAutomationStore;
  private readonly db: DatabaseAdapter;
  private readonly getUserTimezone: () => Promise<string>;
  private onChange?: () => void | Promise<void>;

  constructor(db: DatabaseAdapter, options: AutomationServiceOptions) {
    this.db = db;
    this.store = new DatabaseAutomationStore(db);
    this.getUserTimezone = options.getUserTimezone;
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

  async listForOrg(orgId: string): Promise<StoredAutomation[]> {
    const automations = await this.store.listForOrg(orgId);
    return Promise.all(automations.map((automation) => this.enrichAutomation(automation)));
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
    );

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

    const updated: StoredAutomation = {
      ...existing,
      name: input.name?.trim() || existing.name,
      description: input.description?.trim() ?? existing.description,
      prompt: input.prompt?.trim() || existing.prompt,
      trigger,
      enabled: input.enabled ?? existing.enabled,
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
  ): Promise<AutomationRunRecord[]> {
    const automation = orgId
      ? await this.get(automationId, orgId)
      : await this.store.get(automationId);

    if (!automation) {
      throw new Error("Automation not found.");
    }

    const runs = await this.db.listAutomationRuns(automationId, limit);
    return runs.map(toRunRecord);
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

  computeNextRunAt(
    trigger: AutomationTrigger,
    userTimezone = DEFAULT_TIMEZONE,
  ): string | null {
    return computeAutomationNextRunAt(trigger, userTimezone);
  }

  private async resolveProfileId(orgId: string, profileId?: string): Promise<string> {
    const trimmed = profileId?.trim();

    if (trimmed) {
      const profile = await this.db.getProfileForOrg(trimmed, orgId);
      if (profile) {
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

function toRunRecord(run: {
  id: string;
  automationId: string;
  status: AutomationRunRecord["status"];
  startedAt: string;
  completedAt: string | null;
  output: string | null;
  error: string | null;
}): AutomationRunRecord {
  return {
    id: run.id,
    automationId: run.automationId,
    status: run.status,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    output: run.output,
    error: run.error,
  };
}
