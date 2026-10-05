import type { OrgLlmQuotaStatusResponse } from "@nakama/core/contract";
import { Card, CardContent } from "@nakama/ui/card";
import { useEffect, useState } from "react";
import { useAuth } from "@/context/use-auth";
import { client, formatError } from "@/lib/client";

export function OrgLlmQuotaCard() {
  const { activeOrg } = useAuth();
  const [quotaState, setQuotaState] = useState<{
    error: string | null;
    orgId: string;
    quota: OrgLlmQuotaStatusResponse | null;
  } | null>(null);
  const activeOrgId = activeOrg?.id;
  const quota =
    quotaState && quotaState.orgId === activeOrgId ? quotaState.quota : null;
  const error =
    quotaState && quotaState.orgId === activeOrgId ? quotaState.error : null;

  useEffect(() => {
    if (!activeOrg || activeOrg.role !== "admin") {
      return;
    }
    const orgId = activeOrg.id;
    let cancelled = false;
    void client
      .getOrganizationLlmQuotaStatus(orgId)
      .then((next) => {
        if (!cancelled) {
          setQuotaState({ error: null, orgId, quota: next });
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setQuotaState({
            error: formatError(cause),
            orgId,
            quota: null,
          });
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
    <section className="space-y-3">
      <h2 className="font-normal text-muted-foreground/55 text-sm">
        LLM monthly quota
      </h2>
      <Card className="w-full overflow-hidden shadow-none">
        <CardContent className="divide-y divide-border p-0 text-sm">
          {error ? (
            <p className="px-4 py-3 text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          {quota ? (
            <>
              {[
                { label: "Month", value: quota.month },
                { label: "Status", value: quota.status },
                {
                  label: "Turns",
                  value: `${quota.turns.toLocaleString()} / ${quota.turnLimit ? quota.turnLimit.toLocaleString() : "∞"}`,
                },
                {
                  label: "Tokens",
                  value: `${quota.tokens.toLocaleString()} / ${quota.tokenLimit ? quota.tokenLimit.toLocaleString() : "∞"}`,
                },
              ].map(({ label, value }) => (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  key={label}
                >
                  <span>{label}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {value}
                  </span>
                </div>
              ))}
              <p className="px-4 py-3 text-muted-foreground text-xs">
                Warning at {quota.warningPercent}% · month resets at 00:00 UTC
              </p>
            </>
          ) : error ? null : (
            <p className="px-4 py-3 text-muted-foreground">Loading usage…</p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
