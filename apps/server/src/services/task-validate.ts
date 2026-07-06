import { TASK_STATUSES, type TaskStatus } from "@nakama/core";

export function isValidTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}

export function validateTaskInput(input: {
  title: string;
  prompt: string;
  status?: TaskStatus;
}): void {
  if (!input.title.trim()) {
    throw new Error("Task title is required.");
  }

  if (!input.prompt.trim()) {
    throw new Error("Task prompt is required.");
  }

  if (input.status && !isValidTaskStatus(input.status)) {
    throw new Error(`Invalid task status: ${input.status}`);
  }
}
