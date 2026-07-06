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

  private constructor(private readonly db?: DatabaseAdapter) {}

  static async create(db?: DatabaseAdapter): Promise<LlmUsageTracker> {
    const tracker = new LlmUsageTracker(db);
    await tracker.load();
    return tracker;
  }

  private async load(): Promise<void> {
    if (!this.db) {
      return;
    }

    const stored = await this.db.getLlmUsageStats();
    if (stored) {
      this.requestCount = stored.requestCount;
      this.inputTokens = stored.inputTokens;
      this.outputTokens = stored.outputTokens;
      this.estimatedCostUsd = stored.estimatedCostUsd;
      this.trackedSince = stored.trackedSince;
    }

    const byModel = await this.db.listLlmUsageStatsByModel();
    for (const entry of byModel) {
      this.usageByModel.set(entry.modelId, {
        modelId: entry.modelId,
        requestCount: entry.requestCount,
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
        estimatedCostUsd: entry.estimatedCostUsd,
        trackedSince: entry.trackedSince,
      });
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
      this.pricingContext,
    );

    this.requestCount += 1;
    this.inputTokens += inputTokens;
    this.outputTokens += outputTokens;
    this.estimatedCostUsd += costDelta;

    const existing = this.usageByModel.get(modelId);
    this.usageByModel.set(modelId, {
      modelId,
      requestCount: (existing?.requestCount ?? 0) + 1,
      inputTokens: (existing?.inputTokens ?? 0) + inputTokens,
      outputTokens: (existing?.outputTokens ?? 0) + outputTokens,
      estimatedCostUsd: (existing?.estimatedCostUsd ?? 0) + costDelta,
      trackedSince: existing?.trackedSince ?? new Date().toISOString(),
    });

    void this.persist({
      requestCount: 1,
      inputTokens,
      outputTokens,
      estimatedCostUsd: costDelta,
    }, modelId);
  }

  private async persist(delta: {
    requestCount: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
  }, modelId: string): Promise<void> {
    if (!this.db) {
      return;
    }

    try {
      await this.db.incrementLlmUsageStats(delta, this.trackedSince);
      await this.db.incrementLlmUsageStatsByModel(modelId, delta, this.usageByModel.get(modelId)?.trackedSince ?? this.trackedSince);
    } catch (error) {
      console.warn("Failed to persist LLM usage stats:", error);
    }
  }

  getStats(): LlmUsageStats {
    return {
      requestCount: this.requestCount,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      totalTokens: this.inputTokens + this.outputTokens,
      estimatedCostUsd: this.estimatedCostUsd,
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
