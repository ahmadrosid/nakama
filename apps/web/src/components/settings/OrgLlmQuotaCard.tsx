import type { OrgLlmQuotaStatusResponse } from "@nakama/core/contract";
import { Card, CardContent, CardHeader, CardTitle } from "@nakama/ui/card";
import { useEffect, useState } from "react";
import { useAuth } from "@/context/use-auth";
import { client, formatError } from "@/lib/client";

export function OrgLlmQuotaCard() {
  const { activeOrg } = useAuth();
  const [quota, setQuota] = useState<OrgLlmQuotaStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeOrg || activeOrg.role !== "admin") {
      return;
    }
    let cancelled = false;
    void client
      .getOrganizationLlmQuotaStatus(activeOrg.id)
      .then((next) => {
        if (!cancelled) {
          setQuota(next);
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(formatError(cause));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeOrg]);

  if (!activeOrg || activeOrg.role !== "admin") {
    return null;
  }

  return (
    <Card className="overflow-hidden shadow-none">
      <CardHeader className="border-border border-b px-4 py-3">
        <CardTitle className="font-medium text-sm leading-normal tracking-normal">
          LLM monthly quota
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 p-4 text-sm">
        {error ? <p className="text-destructive">{error}</p> : null}
        {quota ? (
          <>
            <p>
              {quota.month} · {quota.status}
            </p>
            <p>
              {quota.turns} / {quota.turnLimit || "∞"} turns ·{" "}
              {quota.tokens.toLocaleString()} /{" "}
              {quota.tokenLimit ? quota.tokenLimit.toLocaleString() : "∞"}{" "}
              tokens
            </p>
            <p className="text-muted-foreground">
              Warning at {quota.warningPercent}% · month resets at 00:00 UTC
            </p>
          </>
        ) : error ? null : (
          <p className="text-muted-foreground">Loading usage…</p>
        )}
      </CardContent>
    </Card>
  );
}
