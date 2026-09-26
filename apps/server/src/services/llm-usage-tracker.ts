import type { LlmUsageModelStats, LlmUsageStats } from "@nakama/core";
import type { DatabaseAdapter } from "@nakama/db";
import {
  estimateUsageCostUsd,
  getExplicitModelPricing,
  type PricingContext,
} from "../providers/pricing";

export interface LlmUsageRecordOptions {
  cachedInputTokens?: number;
  /** Owning tenant. The ledger is per org, so an unattributable call is not stored. */
  orgId: string;
  pricingContext?: PricingContext;
}

/**
 * Token and cost totals, one ledger per org.
 *
 * The row is the source of truth. An earlier version kept a process-wide
 * running total loaded once at boot, which meant every org-scoped read answered
 * with the whole install's spend (#1306) and nothing on disk said whose it was.
 */
export class LlmUsageTracker {
  private readonly pendingWrites = new Set<Promise<void>>();

  constructor(private readonly db?: DatabaseAdapter) {}

  /**
   * A read must not answer from a ledger a just-finished model call has not
   * reached yet, so every read waits for the writes in flight. They are short
   * local statements, and a read that skipped them would show totals lagging
   * behind the traffic that produced them.
   */
  private async settled(): Promise<void> {
    while (this.pendingWrites.size > 0) {
      await Promise.all([...this.pendingWrites]);
    }
  }

  /**
   * Returns the cost of this call, or null when the model has no published
   * rates. The running totals still use the fallback rate, but a null keeps
   * the house guess out of anything shown to the user as money.
   */
  record(
    modelId: string,
    inputTokens: number,
    outputTokens: number,
    options: LlmUsageRecordOptions
  ): number | null {
    const orgId = options.orgId.trim();
    if (!orgId) {
      return null;
    }

    const { cachedInputTokens = 0, pricingContext = {} } = options;
    const costDelta = estimateUsageCostUsd(
      modelId,
      inputTokens,
      outputTokens,
      pricingContext,
      cachedInputTokens
    );

    const delta = {
      estimatedCostUsd: costDelta,
      inputTokens,
      outputTokens,
      requestCount: 1,
    };
    // Fire and forget on purpose: a counter for a dashboard must never delay a
    // model response or fail a turn, so the write is not awaited here and a
    // rejection is swallowed inside persist().
    const write = this.persist(orgId, modelId, delta);
    this.pendingWrites.add(write);
    void write.finally(() => this.pendingWrites.delete(write));

    return getExplicitModelPricing(modelId, pricingContext) === null
      ? null
      : costDelta;
  }

  private async persist(
    orgId: string,
    modelId: string,
    delta: {
      requestCount: number;
      inputTokens: number;
      outputTokens: number;
      estimatedCostUsd: number;
    }
  ): Promise<void> {
    if (!this.db) {
      return;
    }

    const trackedSince = new Date().toISOString();

    try {
      await this.db.incrementLlmUsageStats(orgId, delta, trackedSince);
      await this.db.incrementLlmUsageStatsByModel(
        orgId,
        modelId,
        delta,
        trackedSince
      );
    } catch (error) {
      console.warn("Failed to persist LLM usage stats:", error);
    }
  }

  async getStats(orgId: string): Promise<LlmUsageStats> {
    await this.settled();
    const stored = await this.db?.getLlmUsageStats(orgId);

    if (!stored) {
      return {
        estimatedCostUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        requestCount: 0,
        totalTokens: 0,
        trackedSince: new Date().toISOString(),
      };
    }

    return {
      estimatedCostUsd: stored.estimatedCostUsd,
      inputTokens: stored.inputTokens,
      outputTokens: stored.outputTokens,
      requestCount: stored.requestCount,
      totalTokens: stored.inputTokens + stored.outputTokens,
      trackedSince: stored.trackedSince,
    };
  }

  async getStatsByModel(orgId: string): Promise<LlmUsageModelStats[]> {
    await this.settled();
    const byModel = await this.db?.listLlmUsageStatsByModel(orgId);

    return (byModel ?? [])
      .map((entry) => ({
        estimatedCostUsd: entry.estimatedCostUsd,
        inputTokens: entry.inputTokens,
        modelId: entry.modelId,
        outputTokens: entry.outputTokens,
        requestCount: entry.requestCount,
        totalTokens: entry.inputTokens + entry.outputTokens,
        trackedSince: entry.trackedSince,
      }))
      .sort((left, right) => {
        if (right.requestCount !== left.requestCount) {
          return right.requestCount - left.requestCount;
        }

        if (right.totalTokens !== left.totalTokens) {
          return right.totalTokens - left.totalTokens;
        }

        return left.modelId.localeCompare(right.modelId);
      });
  }
}
