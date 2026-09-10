import type { OrgLlmQuotaStatusResponse } from "@nakama/core/contract";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    <Card>
      <CardHeader>
        <CardTitle>LLM monthly quota</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
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
