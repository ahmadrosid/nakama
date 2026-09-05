import { useQuery } from "@tanstack/react-query";
import { Cancel01Icon, CheckmarkCircle01Icon } from "hugeicons-react";
import {
  type ChatListItem,
  formatSessionRelativeTime,
} from "@/lib/chat-history";
import {
  activeWorkflowStepIndex,
  buildWorkflowStepViews,
  formatWorkflowRunStatusLabel,
  isListWorkflowsTool,
  isRunWorkflowTool,
  parseListWorkflowsResult,
  parseRunWorkflowResult,
  parseWorkflowId,
  pickRunningWorkflowRun,
  type WorkflowStepView,
} from "@/lib/chat-stream-workflow";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";

const cardSurface =
  "rounded-xl bg-card px-4 py-3 shadow-sm ring-1 ring-border/80 dark:shadow-none";

export function WorkflowRunToolRow({ message }: { message: ChatListItem }) {
  const { statusLabel, title, views } = useWorkflowRunCard(message);

  return (
    <section className={cardSurface}>
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="min-w-0 truncate text-balance font-medium text-foreground text-sm">
          {title}
        </h3>
        <p className="shrink-0 text-muted-foreground text-xs tabular-nums">
          {statusLabel}
        </p>
      </header>
      <WorkflowChecklist views={views} />
    </section>
  );
}

function useWorkflowRunCard(message: ChatListItem) {
  const workflowId = parseWorkflowId(message.toolInput);
  const parsed = parseRunWorkflowResult(message.toolResult);
  const isRunning = message.toolStatus === "running";

  const workflowQuery = useQuery({
    enabled: Boolean(workflowId) && isRunWorkflowTool(message.tool),
    queryFn: () => client.getWorkflow(workflowId!),
    queryKey: queryKeys.workflows.detail(workflowId ?? ""),
  });

  const runsQuery = useQuery({
    enabled: Boolean(workflowId) && isRunning,
    queryFn: () => client.listWorkflowRuns(workflowId!),
    queryKey: queryKeys.workflows.runs(workflowId ?? ""),
    refetchInterval: isRunning ? 800 : false,
  });

  const run =
    parsed?.run ??
    (isRunning ? pickRunningWorkflowRun(runsQuery.data ?? []) : null);
  const views = buildWorkflowStepViews(workflowQuery.data?.steps ?? [], run);
  const status =
    parsed?.status ?? run?.status ?? (isRunning ? "running" : "completed");

  return {
    statusLabel: formatWorkflowRunStatusLabel(
      status,
      isRunning,
      activeWorkflowStepIndex(views),
      views.length
    ),
    title: workflowQuery.data?.name ?? parsed?.name ?? "Workflow",
    views,
  };
}

function WorkflowChecklist({ views }: { views: WorkflowStepView[] }) {
  if (views.length === 0) {
    return (
      <p className="text-pretty text-muted-foreground text-sm">Starting…</p>
    );
  }

  return (
    <ol className="flex flex-col gap-3">
      {views.map((step) => (
        <WorkflowChecklistItem key={step.id} step={step} />
      ))}
    </ol>
  );
}

function WorkflowChecklistItem({ step }: { step: WorkflowStepView }) {
  const pending = step.status === "pending" || step.status === "running";

  return (
    <li className="flex items-start gap-2.5">
      <StepMark className="mt-0.5" status={step.status} />
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "min-w-0 truncate text-pretty text-sm",
            pending ? "text-muted-foreground" : "text-foreground"
          )}
        >
          {step.title}
          {step.tag ? (
            <span className="ml-1.5 font-normal text-muted-foreground text-xs">
              {step.tag}
            </span>
          ) : null}
        </p>
        <p className="truncate text-pretty text-muted-foreground text-xs">
          {step.detail}
        </p>
      </div>
      {step.meta ? (
        <p
          className={cn(
            "max-w-[40%] shrink-0 text-right text-xs tabular-nums",
            step.status === "failed"
              ? "text-red-600 dark:text-red-400"
              : "text-emerald-600 dark:text-emerald-400"
          )}
        >
          {step.meta}
        </p>
      ) : null}
    </li>
  );
}

function StepMark({
  status,
  className,
}: {
  status: WorkflowStepView["status"];
  className?: string;
}) {
  if (status === "completed") {
    return (
      <CheckmarkCircle01Icon
        aria-hidden
        className={cn("size-4 shrink-0 text-emerald-500", className)}
      />
    );
  }

  if (status === "failed") {
    return (
      <Cancel01Icon
        aria-hidden
        className={cn("size-4 shrink-0 text-red-500", className)}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        "size-4 shrink-0 rounded-full border border-border",
        className
      )}
    />
  );
}

export function WorkflowListToolRow({ message }: { message: ChatListItem }) {
  const isRunning = message.toolStatus === "running";
  const workflows = isListWorkflowsTool(message.tool)
    ? parseListWorkflowsResult(message.toolResult)
    : [];

  return (
    <section className={cardSurface}>
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="min-w-0 truncate text-balance font-medium text-foreground text-sm">
          Workflows
        </h3>
        <p className="shrink-0 text-muted-foreground text-xs tabular-nums">
          {isRunning ? "Loading…" : workflows.length || "None"}
        </p>
      </header>
      {isRunning || workflows.length === 0 ? null : (
        <ol className="flex flex-col gap-3">
          {workflows.map((workflow) => (
            <li
              className="flex items-start justify-between gap-3"
              key={workflow.id}
            >
              <div className="min-w-0 flex-1">
                <p className="min-w-0 truncate text-pretty text-foreground text-sm">
                  {workflow.name}
                  {workflow.enabled ? null : (
                    <span className="ml-1.5 font-normal text-muted-foreground text-xs">
                      Off
                    </span>
                  )}
                </p>
                {workflow.description ? (
                  <p className="truncate text-pretty text-muted-foreground text-xs">
                    {workflow.description}
                  </p>
                ) : null}
              </div>
              <p className="max-w-[40%] shrink-0 text-right text-muted-foreground text-xs tabular-nums">
                {listedWorkflowMeta(workflow.stepCount, workflow.lastRunAt)}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function listedWorkflowMeta(
  stepCount: number | null,
  lastRunAt: string | null
): string {
  const steps =
    stepCount == null
      ? null
      : stepCount === 1
        ? "1 step"
        : `${stepCount} steps`;
  const when = lastRunAt ? formatSessionRelativeTime(lastRunAt) : null;
  return [steps, when].filter(Boolean).join(" · ");
}
