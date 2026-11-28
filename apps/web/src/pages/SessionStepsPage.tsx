import type { PlatformSessionStepCursor } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { client, formatError } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

function stepsPath(orgId: string, sessionId: string): string {
  return `/organization/${encodeURIComponent(orgId)}/sessions/${encodeURIComponent(sessionId)}/steps`;
}

function stepHref(
  orgId: string,
  sessionId: string,
  cursor: PlatformSessionStepCursor
): string {
  const params = new URLSearchParams({
    at: cursor.startedAt,
    id: String(cursor.id),
  });

  return `${stepsPath(orgId, sessionId)}?${params.toString()}`;
}

function parseStepId(raw: string | null) {
  if (raw === null) {
    return { id: undefined, invalid: false };
  }

  if (!/^\d+$/.test(raw)) {
    return { id: undefined, invalid: true };
  }

  const value = Number(raw);

  if (!(Number.isSafeInteger(value) && value > 0)) {
    return { id: undefined, invalid: true };
  }

  return { id: value, invalid: false };
}

function formatTime(value: string): string {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function SessionStepsPage() {
  const { orgId = "", sessionId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const at = searchParams.get("at") ?? undefined;

  const { id: stepId, invalid: invalidStepId } = parseStepId(
    searchParams.get("id")
  );

  const step = useQuery({
    enabled: Boolean(orgId && sessionId) && !invalidStepId,
    queryFn: () =>
      client.getPlatformSessionSteps(orgId, sessionId, {
        at,
        id: stepId,
      }),
    queryKey: queryKeys.platformSessionSteps(orgId, sessionId, at, stepId),
    retry: false,
  });

  if (invalidStepId) {
    return (
      <section className="mx-auto min-w-0 max-w-3xl space-y-4">
        <h2 className="break-words font-semibold text-xl">Session recording</h2>
        <div className="space-y-2" role="alert">
          <p>The step ID must be a positive whole number.</p>
          <Button
            nativeButton={false}
            render={<Link to={stepsPath(orgId, sessionId)} />}
            variant="outline"
          >
            Open first step
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto min-w-0 max-w-3xl space-y-4">
      <h2 className="break-words font-semibold text-xl">Session recording</h2>
      {step.isPending && <p role="status">Loading step…</p>}
      {step.isError && (
        <div className="space-y-2" role="alert">
          <p>{formatError(step.error)}</p>
          <Button
            disabled={step.isFetching}
            onClick={() => void step.refetch()}
            variant="outline"
          >
            Retry
          </Button>
        </div>
      )}
      {step.data?.step && (
        <dl className="grid min-w-0 gap-3 break-words text-sm sm:grid-cols-[6rem_minmax(0,1fr)]">
          <dt>Tool</dt>
          <dd className="font-mono">{step.data.step.toolName}</dd>
          <dt>Actor</dt>
          <dd className="capitalize">{step.data.step.actor}</dd>
          <dt>Outcome</dt>
          <dd className="capitalize">{step.data.step.outcome}</dd>
          <dt>Started</dt>
          <dd>
            <time dateTime={step.data.step.startedAt}>
              {formatTime(step.data.step.startedAt)}
            </time>
          </dd>
          <dt>Completed</dt>
          <dd>
            <time dateTime={step.data.step.completedAt}>
              {formatTime(step.data.step.completedAt)}
            </time>
          </dd>
        </dl>
      )}
      {step.data && !step.data.step && (
        <p className="text-muted-foreground text-sm" role="status">
          {step.data.next
            ? "No step at this time."
            : "No steps recorded for this session."}
        </p>
      )}
      {step.data && (
        <div className="flex items-center justify-between gap-3">
          {step.data.previous ? (
            <Button
              nativeButton={false}
              render={
                <Link to={stepHref(orgId, sessionId, step.data.previous)} />
              }
              variant="outline"
            >
              Previous
            </Button>
          ) : (
            <Button disabled variant="outline">
              Previous
            </Button>
          )}
          {step.data.next ? (
            <Button
              nativeButton={false}
              render={<Link to={stepHref(orgId, sessionId, step.data.next)} />}
            >
              Next
            </Button>
          ) : (
            <Button disabled>Next</Button>
          )}
        </div>
      )}
    </section>
  );
}
