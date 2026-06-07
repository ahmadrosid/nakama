import type { TaskStatus } from "@tinyclaw/core/contract";
import type { LucideIcon } from "lucide-react";
import {
  CheckCircle2Icon,
  CircleDashedIcon,
  ListTodoIcon,
  LoaderIcon,
  XCircleIcon,
} from "lucide-react";

export interface TaskColumnMeta {
  id: TaskStatus;
  label: string;
  description: string;
  emptyMessage: string;
  countBadge: string;
  icon: LucideIcon;
}

export const TASK_COLUMN_META: TaskColumnMeta[] = [
  {
    id: "backlog",
    label: "Backlog",
    description: "Ideas waiting to be picked up",
    emptyMessage: "Drag tasks here or create one to get started.",
    countBadge: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
    icon: CircleDashedIcon,
  },
  {
    id: "todo",
    label: "To Do",
    description: "Ready to run — press play on a card",
    emptyMessage: "Move a task here, then start it with the play button.",
    countBadge: "bg-sky-500/15 text-sky-800 dark:text-sky-200",
    icon: ListTodoIcon,
  },
  {
    id: "in_progress",
    label: "In Progress",
    description: "Agents actively working",
    emptyMessage: "No agents running. Start a task from To Do.",
    countBadge: "bg-amber-500/15 text-amber-900 dark:text-amber-100",
    icon: LoaderIcon,
  },
  {
    id: "done",
    label: "Done",
    description: "Completed — click to open task chat",
    emptyMessage: "Finished tasks appear here. Click one to review the run.",
    countBadge: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200",
    icon: CheckCircle2Icon,
  },
  {
    id: "failed",
    label: "Failed",
    description: "Errors — click to inspect and retry",
    emptyMessage: "Failed runs show here. Open a card to edit or re-run.",
    countBadge: "bg-red-500/15 text-red-800 dark:text-red-200",
    icon: XCircleIcon,
  },
];

export const TASK_COLUMN_META_BY_ID = Object.fromEntries(
  TASK_COLUMN_META.map((column) => [column.id, column]),
) as Record<TaskStatus, TaskColumnMeta>;

export const TASK_STATUS_BADGE: Record<
  TaskStatus,
  { label: string; className: string }
> = {
  backlog: {
    label: "Backlog",
    className: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  },
  todo: {
    label: "To Do",
    className: "bg-sky-500/15 text-sky-800 dark:text-sky-200",
  },
  in_progress: {
    label: "In Progress",
    className: "bg-amber-500/15 text-amber-900 dark:text-amber-100",
  },
  done: {
    label: "Done",
    className: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200",
  },
  failed: {
    label: "Failed",
    className: "bg-red-500/15 text-red-800 dark:text-red-200",
  },
};
