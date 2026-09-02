import type { LlmUsageModelStats, LlmUsageStats } from "@nakama/core";
import type { DatabaseAdapter } from "@nakama/db";
import {
  estimateUsageCostUsd,
  type PricingContext,
} from "../providers/pricing";

export class LlmUsageTracker {
  private requestCount = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private estimatedCostUsd = 0;
  private trackedSince = new Date().toISOString();
  private readonly usageByModel = new Map<
    string,
    Omit<LlmUsageModelStats, "totalTokens">
  >();
  private pricingContext: PricingContext = {};
  private recordRevision = 0;
  private readonly pendingWrites = new Set<Promise<void>>();

  private constructor(private readonly db?: DatabaseAdapter) {}

  static async create(db?: DatabaseAdapter): Promise<LlmUsageTracker> {
    const tracker = new LlmUsageTracker(db);
    await tracker.loadSnapshotIfRevisionUnchanged();
    return tracker;
  }

  private async loadSnapshotIfRevisionUnchanged(
    expectedRevision = this.recordRevision
  ): Promise<boolean> {
    const stored = (await this.db?.getLlmUsageStats()) ?? null;
    const byModel = (await this.db?.listLlmUsageStatsByModel()) ?? [];

    // Publish only a snapshot that spans no record(), otherwise reload retries
    // after the new record's database write finishes.
    if (expectedRevision !== this.recordRevision) {
      return false;
    }

    this.requestCount = stored?.requestCount ?? 0;
    this.inputTokens = stored?.inputTokens ?? 0;
    this.outputTokens = stored?.outputTokens ?? 0;
    this.estimatedCostUsd = stored?.estimatedCostUsd ?? 0;
    this.trackedSince = stored?.trackedSince ?? new Date().toISOString();
    this.usageByModel.clear();
    for (const entry of byModel) {
      this.usageByModel.set(entry.modelId, {
        estimatedCostUsd: entry.estimatedCostUsd,
        inputTokens: entry.inputTokens,
        modelId: entry.modelId,
        outputTokens: entry.outputTokens,
        requestCount: entry.requestCount,
        trackedSince: entry.trackedSince,
      });
    }
    return true;
  }

  async reloadFromDatabase(): Promise<void> {
    while (true) {
      const revision = this.recordRevision;
      await Promise.all(this.pendingWrites);

      if (revision !== this.recordRevision) {
        continue;
      }

      if (await this.loadSnapshotIfRevisionUnchanged(revision)) {
        return;
      }
    }
  }

  setPricingContext(context: PricingContext): void {
    this.pricingContext = context;
  }

  record(modelId: string, inputTokens: number, outputTokens: number): void {
    const costDelta = estimateUsageCostUsd(
      modelId,
      inputTokens,
      outputTokens,
      this.pricingContext
    );

    this.recordRevision += 1;
    this.requestCount += 1;
    this.inputTokens += inputTokens;
    this.outputTokens += outputTokens;
    this.estimatedCostUsd += costDelta;

    const existing = this.usageByModel.get(modelId);
    this.usageByModel.set(modelId, {
      estimatedCostUsd: (existing?.estimatedCostUsd ?? 0) + costDelta,
      inputTokens: (existing?.inputTokens ?? 0) + inputTokens,
      modelId,
      outputTokens: (existing?.outputTokens ?? 0) + outputTokens,
      requestCount: (existing?.requestCount ?? 0) + 1,
      trackedSince: existing?.trackedSince ?? new Date().toISOString(),
    });

    const persistence = this.persist(
      {
        estimatedCostUsd: costDelta,
        inputTokens,
        outputTokens,
        requestCount: 1,
      },
      modelId
    );
    this.pendingWrites.add(persistence);
    void persistence.then(() => {
      this.pendingWrites.delete(persistence);
    });
  }

  private async persist(
    delta: {
      requestCount: number;
      inputTokens: number;
      outputTokens: number;
      estimatedCostUsd: number;
    },
    modelId: string
  ): Promise<void> {
    if (!this.db) {
      return;
    }

    try {
      await this.db.incrementLlmUsageStats(delta, this.trackedSince);
      await this.db.incrementLlmUsageStatsByModel(
        modelId,
        delta,
        this.usageByModel.get(modelId)?.trackedSince ?? this.trackedSince
      );
    } catch (error) {
      console.warn("Failed to persist LLM usage stats:", error);
    }
  }

  getStats(): LlmUsageStats {
    return {
      estimatedCostUsd: this.estimatedCostUsd,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      requestCount: this.requestCount,
      totalTokens: this.inputTokens + this.outputTokens,
      trackedSince: this.trackedSince,
    };
  }

  getStatsByModel(): LlmUsageModelStats[] {
    return [...this.usageByModel.values()]
      .map((entry) => ({
        ...entry,
        totalTokens: entry.inputTokens + entry.outputTokens,
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
