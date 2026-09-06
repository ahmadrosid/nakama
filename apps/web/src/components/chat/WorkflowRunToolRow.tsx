import {
  CheckmarkCircle02Icon,
  DashedLineCircleIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { CancelCircleIcon } from "hugeicons-react";
import type { ChatListItem } from "@/lib/chat-history";
import {
  buildWorkflowRunCard,
  isRunWorkflowTool,
  parseRunWorkflowResult,
  parseWorkflowId,
  type WorkflowStepView,
} from "@/lib/chat-stream-workflow";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";

const cardSurface =
  "rounded-xl bg-card px-4 py-3 shadow-sm ring-1 ring-border/80 dark:shadow-none";

function WorkflowRunCard({
  statusLabel,
  title,
  views,
}: {
  statusLabel: string;
  title: string;
  views: WorkflowStepView[];
}) {
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

export function WorkflowRunToolRow({ message }: { message: ChatListItem }) {
  return <WorkflowRunCard {...useWorkflowRunCard(message)} />;
}

function useWorkflowRunCard(message: ChatListItem) {
  const workflowId = parseWorkflowId(message.toolInput);
  const parsed = parseRunWorkflowResult(message.toolResult);
  const isRunning = message.toolStatus === "running";
  const canLoad = Boolean(workflowId) && isRunWorkflowTool(message.tool);

  const workflowQuery = useQuery({
    enabled: canLoad,
    queryFn: () => client.getWorkflow(workflowId!),
    queryKey: queryKeys.workflows.detail(workflowId ?? ""),
  });

  const runsQuery = useQuery({
    enabled: Boolean(workflowId) && isRunning,
    queryFn: () => client.listWorkflowRuns(workflowId!),
    queryKey: queryKeys.workflows.runs(workflowId ?? ""),
    refetchInterval: isRunning ? 800 : false,
  });

  return buildWorkflowRunCard({
    isRunning,
    parsed,
    runs: runsQuery.data ?? [],
    workflow: workflowQuery.data,
  });
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
  const running = step.status === "running";
  const pending = step.status === "pending" || step.status === "skipped";

  return (
    <li className="flex items-start gap-2.5">
      <StepMark className="mt-0.5" status={step.status} />
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "min-w-0 truncate text-pretty text-sm",
            running
              ? "todo-shimmer-text text-foreground"
              : pending
                ? "text-muted-foreground"
                : "text-foreground"
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
      <HugeiconsIcon
        aria-hidden
        className={cn("size-4 shrink-0 text-emerald-500", className)}
        color="currentColor"
        icon={CheckmarkCircle02Icon}
        size={16}
        strokeWidth={1.5}
      />
    );
  }

  if (status === "failed") {
    return (
      <CancelCircleIcon
        aria-hidden
        className={cn("size-4 shrink-0 text-red-500", className)}
      />
    );
  }

  return (
    <HugeiconsIcon
      aria-hidden
      className={cn(
        "size-4 shrink-0 text-muted-foreground",
        status === "running" && "animate-spin",
        className
      )}
      color="currentColor"
      icon={DashedLineCircleIcon}
      size={16}
      strokeWidth={1.5}
    />
  );
}
