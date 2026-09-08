import { useQuery } from "@tanstack/react-query";
import {
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  DashedLineCircleIcon,
} from "hugeicons-react";
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
      {views.length === 0 ? (
        <p className="text-pretty text-muted-foreground text-sm">Starting…</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {views.map((step) => (
            <li className="flex items-start gap-2.5" key={step.id}>
              {renderStepMark(step.status, "mt-0.5")}
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "min-w-0 truncate text-pretty text-sm",
                    stepTitleTone(step.status)
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
                    stepMetaTone(step.status)
                  )}
                >
                  {step.meta}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function useWorkflowDefinition(
  workflowId: string | null,
  tool: string | undefined
) {
  return useQuery({
    enabled: Boolean(workflowId) && isRunWorkflowTool(tool),
    queryFn: () => client.getWorkflow(workflowId!),
    queryKey: queryKeys.workflows.detail(workflowId ?? ""),
  }).data;
}

function useLiveWorkflowRuns(workflowId: string | null, isRunning: boolean) {
  return (
    useQuery({
      enabled: Boolean(workflowId) && isRunning,
      queryFn: () => client.listWorkflowRuns(workflowId!),
      queryKey: queryKeys.workflows.runs(workflowId ?? ""),
      refetchInterval: isRunning ? 800 : false,
    }).data ?? []
  );
}

function useWorkflowRunCard(message: ChatListItem) {
  const workflowId = parseWorkflowId(message.toolInput);
  const isRunning = message.toolStatus === "running";
  return buildWorkflowRunCard({
    isRunning,
    parsed: parseRunWorkflowResult(message.toolResult),
    runs: useLiveWorkflowRuns(workflowId, isRunning),
    workflow: useWorkflowDefinition(workflowId, message.tool),
  });
}

function stepTitleTone(status: WorkflowStepView["status"]): string {
  if (status === "running") {
    return "todo-shimmer-text text-foreground";
  }
  if (status === "pending" || status === "skipped") {
    return "text-muted-foreground";
  }
  return "text-foreground";
}

function stepMetaTone(status: WorkflowStepView["status"]): string {
  if (status === "failed") {
    return "text-red-600 dark:text-red-400";
  }
  return "text-emerald-600 dark:text-emerald-400";
}

function renderStepMark(
  status: WorkflowStepView["status"],
  className?: string
) {
  if (status === "failed") {
    return (
      <CancelCircleIcon
        aria-hidden
        className={cn("size-4 shrink-0 text-red-500", className)}
      />
    );
  }

  const completed = status === "completed";
  const Icon = completed ? CheckmarkCircle02Icon : DashedLineCircleIcon;
  return (
    <Icon
      aria-hidden
      className={cn(
        "size-4 shrink-0",
        completed ? "text-emerald-500" : "text-muted-foreground",
        status === "running" && "animate-spin",
        className
      )}
      color="currentColor"
      size={16}
      strokeWidth={1.5}
    />
  );
}
