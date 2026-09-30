import { NakamaApiError } from "@nakama/core";
import type { DatabaseAdapter } from "@nakama/db";

type OrganizationWithLlmTurnLimit = {
  monthlyLlmTokenLimit?: number | null;
  monthlyLlmTurnLimit?: number | null;
  monthlyLlmWarningPercent?: number | null;
};

export class OrgUsageQuotaService {
  constructor(
    private readonly db: DatabaseAdapter,
    private readonly now: () => Date = () => new Date()
  ) {}

  async getStatus(orgId: string): Promise<{
    month: string;
    status: "blocked" | "ok" | "warning";
    tokenLimit: number;
    tokens: number;
    turnLimit: number;
    turns: number;
    warningPercent: number;
  }> {
    const organization = (await this.db.getOrganizationById(
      orgId
    )) as OrganizationWithLlmTurnLimit | null;
    const month = this.now().toISOString().slice(0, 7);
    const usage = await this.db.listLlmTurnUsage(orgId);
    const current = usage.filter((entry) => entry.bucket.startsWith(month));
    const turns = current.reduce((total, entry) => total + entry.turns, 0);
    const tokens = current.reduce(
      (total, entry) => total + entry.inputTokens + entry.outputTokens,
      0
    );
    const turnLimit = organization?.monthlyLlmTurnLimit ?? 0;
    const tokenLimit = organization?.monthlyLlmTokenLimit ?? 0;
    const warningPercent = organization?.monthlyLlmWarningPercent ?? 80;
    const turnRatio = turnLimit > 0 ? turns / turnLimit : 0;
    const tokenRatio = tokenLimit > 0 ? tokens / tokenLimit : 0;
    const status =
      (turnLimit > 0 && turns >= turnLimit) ||
      (tokenLimit > 0 && tokens >= tokenLimit)
        ? "blocked"
        : turnRatio >= warningPercent / 100 ||
            tokenRatio >= warningPercent / 100
          ? "warning"
          : "ok";

    return {
      month,
      status,
      tokenLimit,
      tokens,
      turnLimit,
      turns,
      warningPercent,
    };
  }

  /**
   * Reserves one turn's worth of quota, or throws 429. Resolves to a release
   * function the caller must invoke once the turn is settled — a throw, a
   * cancellation, or a turn that ends without reaching the provider all burn
   * the hold otherwise. The release is idempotent so a caller with several
   * exit paths can just call it from each one.
   */
  async reserveLlmTurn(
    orgId: string,
    reservedTokens = 0
  ): Promise<() => Promise<void>> {
    const organization = (await this.db.getOrganizationById(
      orgId
    )) as OrganizationWithLlmTurnLimit | null;

    if (
      !(
        (organization?.monthlyLlmTurnLimit &&
          organization.monthlyLlmTurnLimit > 0) ||
        (organization?.monthlyLlmTokenLimit &&
          organization.monthlyLlmTokenLimit > 0)
      )
    ) {
      return async () => {};
    }

    const status = await this.getStatus(orgId);
    if (
      (organization?.monthlyLlmTurnLimit &&
        organization.monthlyLlmTurnLimit > 0 &&
        status.turns >= organization.monthlyLlmTurnLimit) ||
      (organization?.monthlyLlmTokenLimit &&
        organization.monthlyLlmTokenLimit > 0 &&
        status.tokens >= organization.monthlyLlmTokenLimit)
    ) {
      throw new NakamaApiError("Monthly LLM quota reached.", 429);
    }
    const tokens = Math.max(0, Math.ceil(reservedTokens));
    const reserved = await this.db.tryReserveMonthlyLlmQuota({
      existingTokens: status.tokens,
      existingTurns: status.turns,
      month: status.month,
      orgId,
      reservedTokens: tokens,
      updatedAt: new Date().toISOString(),
    });
    if (!reserved) {
      throw new NakamaApiError("Monthly LLM quota reached.", 429);
    }

    let released = false;
    return async () => {
      if (released) {
        return;
      }
      released = true;
      try {
        await this.db.releaseMonthlyLlmQuota({
          month: status.month,
          orgId,
          reservedTokens: tokens,
          updatedAt: new Date().toISOString(),
        });
      } catch (error) {
        // Never let the release turn a finished turn into a failure.
        console.warn(
          `Failed to release LLM quota reservation for org ${orgId}:`,
          error
        );
      }
    };
  }

  /**
   * Kept for callers that only need the gate. Prefer reserveLlmTurn, which
   * also returns the release.
   */
  async assertCanStartLlmTurn(
    orgId: string,
    reservedTokens = 0
  ): Promise<void> {
    await this.reserveLlmTurn(orgId, reservedTokens);
  }
}
