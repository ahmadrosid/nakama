import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
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
  isWorkerSchedulable,
  NakamaApiError,
  normalizeAutomationDelivery,
  resolveScheduleTimezone,
  resolveWebPublicUrl,
  summarizeAutomationUnreadCounts,
  validateAutomationDelivery,
  validateAutomationInput,
} from "@nakama/core";
import { type DatabaseAdapter, DatabaseAutomationStore } from "@nakama/db";
import {
  assertCanAutomateMailbox,
  type ProfileAccess,
  resolveProfileId,
} from "./automation-profile-access";
import {
  automationBelongsToOrg,
  normalizeToolLimit,
  toRunRecord,
} from "./automation-records";
import type { ManagedSecrets } from "./managed-secrets";

const WEBHOOK_SIGNATURE_PATTERN = /^sha256=([0-9a-f]{64})$/;

export interface AutomationServiceOptions {
  canSendEmail?: (profileId: string, orgId: string) => Promise<boolean>;
  getUserTimezone: () => Promise<string>;
  onChange?: () => void | Promise<void>;
  secrets?: Pick<
    ManagedSecrets,
    "decryptWebhookSecret" | "encryptWebhookSecret"
  >;
}

export class AutomationService {
  private readonly runProgress = new Map<
    string,
    Pick<AutomationRunRecord, "output" | "progress">
  >();
  private readonly store: DatabaseAutomationStore;
  private readonly db: DatabaseAdapter;
  private readonly getUserTimezone: () => Promise<string>;
  private readonly canSendEmail?: (
    profileId: string,
    orgId: string
  ) => Promise<boolean>;
  private onChange?: () => void | Promise<void>;
  private readonly secrets?: AutomationServiceOptions["secrets"];

  constructor(db: DatabaseAdapter, options: AutomationServiceOptions) {
    this.db = db;
    this.store = new DatabaseAutomationStore(db);
    this.getUserTimezone = options.getUserTimezone;
    this.canSendEmail = options.canSendEmail;
    this.onChange = options.onChange;
    this.secrets = options.secrets;
  }

  setOnChange(onChange: () => void | Promise<void>): void {
    this.onChange = onChange;
  }

  /** All automations — used by the scheduler across orgs. */
  async listAll(): Promise<StoredAutomation[]> {
    const automations = await this.store.list();

    const enabled = await Promise.all(
      automations.map(async (automation) =>
        (await this.isProfileAutomationEnabled(automation.profileId))
          ? automation
          : null
      )
    );

    return Promise.all(
      enabled
        .filter(
          (automation): automation is StoredAutomation => automation !== null
        )
        .map((automation) => this.enrichAutomation(automation))
    );
  }

  async listForOrg(
    orgId: string,
    userId?: string
  ): Promise<{
    automations: StoredAutomation[];
    unread?: AutomationUnreadSummary;
  }> {
    const automations = await this.store.listForOrg(orgId);

    const enriched = await Promise.all(
      automations.map((automation) => this.enrichAutomation(automation))
    );

    const unread = userId
      ? await this.getUnreadSummary(orgId, userId)
      : undefined;

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
    access?: ProfileAccess
  ): Promise<StoredAutomation> {
    const userTimezone = await this.getUserTimezone();
    const trigger = resolveScheduleTimezone(input.trigger, userTimezone);

    validateAutomationInput({
      name: input.name,
      prompt: input.prompt,
      trigger,
    });

    const profileId = await resolveProfileId(
      this.db,
      orgId,
      profileIdOverride ?? input.profileId,
      access
    );

    await this.assertCanAutomateMailbox(profileId, access);

    const delivery = normalizeAutomationDelivery(input.delivery);
    await validateAutomationDelivery(delivery, {
      access: {
        isPlatformAdmin: access?.isPlatformAdmin,
        orgRole: access?.orgRole,
      },
      isEmailConfigured: this.canSendEmail
        ? () => this.canSendEmail!(profileId, orgId)
        : undefined,
      orgId,
      profileId,
    });

    const now = new Date().toISOString();

    const automation: StoredAutomation = {
      createdAt: now,
      description: input.description?.trim() || input.prompt.trim(),
      enabled: input.enabled ?? true,
      id: createId("automation"),
      name: input.name.trim(),
      orgId,
      profileId,
      prompt: input.prompt.trim(),
      runAsUserId: access?.userId ?? null,
      steps: [],
      trigger,
      updatedAt: now,
      version: 1,
    };

    if (delivery) {
      automation.delivery = delivery;
    }

    if (input.toolLimit) {
      automation.toolLimit = normalizeToolLimit(input.toolLimit);
    }

    const profile = await this.db.getProfile(profileId);

    const isFirstAutomation = !(
      await this.db.listAutomationsForOrg(orgId)
    ).some((existing) => existing.profileId === profileId);

    await this.store.save(automation);

    // The first automation is the user's consent to run automations.
    if (profile && profile.automationsEnabled === false && isFirstAutomation) {
      await this.db.upsertProfile({
        ...profile,
        automationsEnabled: true,
        updatedAt: now,
      });
    }

    await this.notifyChange();

    return this.enrichAutomation(automation);
  }

  async update(
    id: string,
    orgId: string,
    input: UpdateAutomationRequest,
    access?: ProfileAccess
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

    let profileId = existing.profileId;

    if (input.profileId !== undefined) {
      if (!input.profileId.trim()) {
        throw new Error("Profile id is required.");
      }

      profileId = await resolveProfileId(
        this.db,
        orgId,
        input.profileId,
        access
      );
    }

    // Only the runner updates without `access`, to switch a runAt job off.
    // Any other change (delivery included) can redirect mailbox output.
    if (access) {
      await this.assertCanAutomateMailbox(profileId, access);
    }

    let delivery = existing.delivery;

    if (input.delivery === null) {
      delivery = undefined;
    } else if (input.delivery !== undefined) {
      delivery = normalizeAutomationDelivery(input.delivery);
    }

    await validateAutomationDelivery(delivery, {
      access: {
        isPlatformAdmin: access?.isPlatformAdmin,
        orgRole: access?.orgRole,
      },
      isEmailConfigured: this.canSendEmail
        ? () => this.canSendEmail!(profileId, orgId)
        : undefined,
      orgId,
      previousDelivery: existing.delivery,
      profileId,
    });

    let toolLimit = existing.toolLimit;

    if (input.toolLimit === null) {
      toolLimit = undefined;
    } else if (input.toolLimit !== undefined) {
      toolLimit = normalizeToolLimit(input.toolLimit);
    }

    const prompt = input.prompt?.trim() || existing.prompt;

    // Whoever changes what a run does lends their Composio sign-ins, so
    // nobody can steer another person's accounts. A pause, rename, or new
    // schedule keeps the current person. The runner saves with no access.
    const steers =
      prompt !== existing.prompt ||
      profileId !== existing.profileId ||
      JSON.stringify(delivery) !== JSON.stringify(existing.delivery) ||
      JSON.stringify(toolLimit) !== JSON.stringify(existing.toolLimit) ||
      (trigger.type === "webhook" && existing.trigger.type !== "webhook");

    const updated: StoredAutomation = {
      ...existing,
      delivery,
      description: input.description?.trim() ?? existing.description,
      enabled: input.enabled ?? existing.enabled,
      name: input.name?.trim() || existing.name,
      profileId,
      prompt,
      runAsUserId:
        access && steers ? (access.userId ?? null) : existing.runAsUserId,
      toolLimit,
      trigger,
      updatedAt: new Date().toISOString(),
      version: existing.version + 1,
    };

    // Before the save: a failed delete keeps the row, so no old secret revives.
    if (existing.trigger.type !== "webhook" && trigger.type === "webhook") {
      await this.db.deleteAutomationWebhookSecret(id);
    }

    await this.store.save(updated);

    // After the save: a failed save keeps the secret.
    // Runs after the row change, so it only logs. The next switch to webhook deletes a leftover.
    if (existing.trigger.type === "webhook" && trigger.type !== "webhook") {
      try {
        await this.db.deleteAutomationWebhookSecret(id);
      } catch (error) {
        console.error("Automation webhook secret could not be deleted:", error);
      }
    }

    await this.notifyChange();

    return this.enrichAutomation(updated);
  }

  /** New secret; the old one stops at once. Runs now use the caller's sign-ins. */
  async createWebhookSecret(
    id: string,
    orgId: string,
    userId: string
  ): Promise<string> {
    const automation = await this.get(id, orgId);

    if (!automation) {
      throw new NakamaApiError("Automation not found.", 404);
    }

    if (automation.trigger.type !== "webhook") {
      throw new NakamaApiError("Set the trigger to webhook first.", 400);
    }

    if (!this.secrets) {
      throw new NakamaApiError(
        "Set NAKAMA_SECRETS_KEY before saving secrets.",
        400
      );
    }

    const secret = randomBytes(32).toString("base64url");
    let encryptedValue: string;

    try {
      encryptedValue = this.secrets.encryptWebhookSecret(id, secret);
    } catch (error) {
      // ManagedSecrets throws this exact copy when the key is unset.
      if (
        error instanceof Error &&
        error.message.includes("NAKAMA_SECRETS_KEY")
      ) {
        throw new NakamaApiError(
          `${error.message} Create a key with \`openssl rand -base64 32\`.`,
          400
        );
      }

      throw error;
    }

    // The maker holds the secret, so revoking their access deletes it.
    await this.db.putAutomationWebhookSecret({
      automationId: id,
      createdAt: new Date().toISOString(),
      createdByUserId: userId,
      encryptedValue,
    });

    // Last, so a failed encrypt or put leaves the old maker bound to the old secret.
    if (automation.runAsUserId !== userId) {
      await this.store.save({
        ...automation,
        runAsUserId: userId,
        updatedAt: new Date().toISOString(),
        version: automation.version + 1,
      });
    }

    return secret;
  }

  /** Checks a GitHub-style `X-Hub-Signature-256` header against the raw body. */
  async verifyWebhookSignature(
    automation: StoredAutomation,
    body: Uint8Array,
    header: string | undefined
  ): Promise<boolean> {
    const match = WEBHOOK_SIGNATURE_PATTERN.exec(header ?? "");

    if (!(match?.[1] && this.secrets)) {
      return false;
    }

    const row = await this.db.getAutomationWebhookSecret(automation.id);

    // Runs use runAsUserId's sign-ins, so only that person's secret may start one.
    if (!row || row.createdByUserId !== automation.runAsUserId) {
      return false;
    }

    let secret: string;

    try {
      secret = this.secrets.decryptWebhookSecret(row);
    } catch (error) {
      console.error("Automation webhook secret could not be read:", error);

      return false;
    }

    const expected = createHmac("sha256", secret).update(body).digest();
    const received = Buffer.from(match[1], "hex");

    // The pattern fixes the length, so timingSafeEqual cannot throw here.
    return timingSafeEqual(expected, received);
  }

  claimWebhookDelivery(
    automationId: string,
    deliveryId: string
  ): Promise<boolean> {
    return this.db.claimAutomationWebhookDelivery(
      automationId,
      deliveryId,
      new Date().toISOString()
    );
  }

  releaseWebhookDelivery(
    automationId: string,
    deliveryId: string
  ): Promise<void> {
    return this.db.releaseAutomationWebhookDelivery(automationId, deliveryId);
  }

  async delete(id: string, orgId: string): Promise<boolean> {
    const existing = await this.get(id, orgId);

    if (!existing) {
      return false;
    }

    const deleted = await this.store.delete(id);

    // The secret row goes with the automation (FK cascade).
    if (deleted) {
      await this.notifyChange();
    }

    return deleted;
  }

  async listRuns(
    automationId: string,
    orgId?: string,
    limit = 20,
    userId?: string
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

    return runs.map((run) => {
      const record = toRunRecord(run, readThroughAt);

      const progress =
        run.status === "running" ? this.runProgress.get(run.id) : undefined;

      if (progress) {
        Object.assign(record, progress);
      }

      return record;
    });
  }

  setRunProgress(
    runId: string,
    progress?: Pick<AutomationRunRecord, "output" | "progress">
  ): void {
    if (progress === undefined) {
      this.runProgress.delete(runId);
    } else {
      this.runProgress.set(runId, progress);
    }
  }

  async markRunsRead(
    automationId: string,
    orgId: string,
    userId: string
  ): Promise<{ readThroughAt: string }> {
    const automation = await this.get(automationId, orgId);

    if (!automation) {
      throw new Error("Automation not found.");
    }

    const readThroughAt = new Date().toISOString();
    await this.db.upsertAutomationRunReadThrough(
      userId,
      orgId,
      automationId,
      readThroughAt
    );

    return { readThroughAt };
  }

  async getUnreadSummary(
    orgId: string,
    userId: string
  ): Promise<AutomationUnreadSummary> {
    const counts = await this.db.countUnreadAutomationRunsByOrg(userId, orgId);

    return summarizeAutomationUnreadCounts(counts);
  }

  async getActiveRun(
    automationId: string
  ): Promise<AutomationRunRecord | null> {
    const run = await this.db.getActiveAutomationRun(automationId);

    return run ? toRunRecord(run) : null;
  }

  async createRun(
    automationId: string,
    webhook?: { input: string }
  ): Promise<AutomationRunRecord> {
    const run = {
      automationId,
      completedAt: null,
      error: null,
      id: createId("run"),
      output: null,
      source: webhook ? ("webhook" as const) : null,
      startedAt: new Date().toISOString(),
      status: "running" as const,
    };

    await this.db.insertAutomationRun({ ...run, input: webhook?.input });

    return toRunRecord(run);
  }

  async completeRun(
    runId: string,
    automationId: string,
    result: { output?: string; error?: string }
  ): Promise<AutomationRunRecord> {
    const run = await this.db.getAutomationRun(automationId, runId);

    if (!run || run.status !== "running") {
      throw new Error("Automation run not found.");
    }

    const completedAt = new Date().toISOString();

    const progress = this.runProgress.get(runId)?.progress?.map((message) =>
      message.role === "tool" && !message.toolCompletedAt
        ? {
            ...message,
            content: JSON.stringify({
              error: "Run ended before this tool completed.",
            }),
            toolCompletedAt: Date.parse(completedAt),
          }
        : { ...message }
    );

    if (progress && result.output && !result.error) {
      const last = progress.at(-1);

      if (last?.role === "assistant" && !last.toolCalls) {
        last.content = result.output;
      } else {
        progress.push({ content: result.output, role: "assistant" });
      }
    }

    const updated = {
      ...run,
      completedAt,
      error: result.error ?? null,
      output: result.output ?? null,
      progress,
      status: result.error ? ("failed" as const) : ("completed" as const),
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
    }
  ): Promise<AutomationRunRecord> {
    const runs = await this.db.listAutomationRuns(automationId, 100);
    const run = runs.find((entry) => entry.id === runId);

    if (!run) {
      throw new Error("Automation run not found.");
    }

    const updated = {
      ...run,
      deliveryError: result.deliveryError,
      deliveryStatus: result.deliveryStatus,
    };

    await this.db.updateAutomationRun(updated);

    return toRunRecord(updated);
  }

  computeNextRunAt(
    trigger: AutomationTrigger,
    userTimezone = DEFAULT_TIMEZONE
  ): string | null {
    return computeAutomationNextRunAt(trigger, userTimezone);
  }

  assertCanAutomateMailbox(
    profileId: string,
    access?: ProfileAccess
  ): Promise<void> {
    return assertCanAutomateMailbox(this.db, profileId, access);
  }

  private async enrichAutomation(
    automation: StoredAutomation
  ): Promise<StoredAutomation> {
    const userTimezone = await this.getUserTimezone();
    const runs = await this.db.listAutomationRuns(automation.id, 1);

    const publicUrl =
      automation.trigger.type === "webhook" ? resolveWebPublicUrl() : undefined;

    return {
      ...automation,
      lastRunAt: runs[0]?.startedAt ?? null,
      lastRunStatus: runs[0]?.status ?? null,
      nextRunAt: isWorkerSchedulable(automation)
        ? this.computeNextRunAt(automation.trigger, userTimezone)
        : null,
      ...(publicUrl && {
        webhookUrl: `${publicUrl}/v1/automations/${encodeURIComponent(automation.id)}/webhook`,
      }),
    };
  }

  async isProfileAutomationEnabled(profileId: string): Promise<boolean> {
    const profile = await this.db.getProfile(profileId);

    return profile?.automationsEnabled !== false;
  }

  private async notifyChange(): Promise<void> {
    await this.onChange?.();
  }
}
