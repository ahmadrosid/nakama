import type { TaskStatus } from "@nakama/core/contract";
import {
  CancelCircleIcon,
  CheckmarkCircle01Icon,
  CircleIcon,
  ListViewIcon,
  Loading03Icon,
} from "hugeicons-react";

export interface TaskColumnMeta {
  countBadge: string;
  description: string;
  emptyMessage: string;
  icon: typeof CircleIcon;
  id: TaskStatus;
  label: string;
}

export const TASK_COLUMN_META: TaskColumnMeta[] = [
  {
    countBadge: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
    description: "Ideas waiting to be picked up",
    emptyMessage: "Drag tasks here or create one to get started.",
    icon: CircleIcon,
    id: "backlog",
    label: "Backlog",
  },
  {
    countBadge: "bg-sky-500/15 text-sky-800 dark:text-sky-200",
    description: "Ready to run — press play on a card",
    emptyMessage: "Move a task here, then start it with the play button.",
    icon: ListViewIcon,
    id: "todo",
    label: "To Do",
  },
  {
    countBadge: "bg-amber-500/15 text-amber-900 dark:text-amber-100",
    description: "Agents actively working",
    emptyMessage: "No agents running. Start a task from To Do.",
    icon: Loading03Icon,
    id: "in_progress",
    label: "In Progress",
  },
  {
    countBadge: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200",
    description: "Completed — click to open task chat",
    emptyMessage: "Finished tasks appear here. Click one to review the run.",
    icon: CheckmarkCircle01Icon,
    id: "done",
    label: "Done",
  },
  {
    countBadge: "bg-red-500/15 text-red-800 dark:text-red-200",
    description: "Errors — click to inspect and retry",
    emptyMessage: "Failed runs show here. Open a card to edit or re-run.",
    icon: CancelCircleIcon,
    id: "failed",
    label: "Failed",
  },
];

export const TASK_COLUMN_META_BY_ID = Object.fromEntries(
  TASK_COLUMN_META.map((column) => [column.id, column])
) as Record<TaskStatus, TaskColumnMeta>;

export const TASK_STATUS_BADGE: Record<
  TaskStatus,
  { label: string; className: string }
> = {
  backlog: {
    className: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
    label: "Backlog",
  },
  done: {
    className: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200",
    label: "Done",
  },
  failed: {
    className: "bg-red-500/15 text-red-800 dark:text-red-200",
    label: "Failed",
  },
  in_progress: {
    className: "bg-amber-500/15 text-amber-900 dark:text-amber-100",
    label: "In Progress",
  },
  todo: {
    className: "bg-sky-500/15 text-sky-800 dark:text-sky-200",
    label: "To Do",
  },
};
