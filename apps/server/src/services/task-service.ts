import type {
  CreateTaskRequest,
  StoredTask,
  TaskRunRecord,
  TaskStatus,
  UpdateTaskRequest,
} from "@tinyclaw/core";
import { createId } from "@tinyclaw/core";
import { DEFAULT_PROFILE_ID, type DatabaseAdapter, type StoredTaskRecord } from "@tinyclaw/db";
import { isValidTaskStatus, validateTaskInput } from "./task-validate";
import type { TaskRunner } from "./task-runner";

export class TaskService {
  private taskRunner: TaskRunner | null = null;

  constructor(private readonly db: DatabaseAdapter) {}

  setTaskRunner(taskRunner: TaskRunner): void {
    this.taskRunner = taskRunner;
  }

  async list(): Promise<StoredTask[]> {
    const records = await this.db.listTasks();
    return records.map((record) => this.toStoredTask(record));
  }

  async get(id: string): Promise<StoredTask | null> {
    const record = await this.db.getTask(id);
    return record ? this.toStoredTask(record) : null;
  }

  async create(
    input: CreateTaskRequest,
    profileId = DEFAULT_PROFILE_ID,
  ): Promise<StoredTask> {
    const status = input.status ?? "backlog";
    validateTaskInput({
      title: input.title,
      prompt: input.prompt,
      status,
    });

    const profile = await this.db.getProfile(profileId);

    if (!profile) {
      throw new Error("Profile not found.");
    }

    const now = new Date().toISOString();
    const task: StoredTaskRecord = {
      id: createId("task"),
      title: input.title.trim(),
      description: input.description?.trim() ?? "",
      prompt: input.prompt.trim(),
      profileId,
      status,
      position: await this.nextPosition(status),
      createdAt: now,
      updatedAt: now,
    };

    await this.db.upsertTask(task);
    return this.toStoredTask(task);
  }

  async update(
    id: string,
    input: UpdateTaskRequest,
    options?: { triggerRun?: boolean },
  ): Promise<StoredTask> {
    const existing = await this.db.getTask(id);

    if (!existing) {
      throw new Error("Task not found.");
    }

    const title = input.title !== undefined ? input.title.trim() : existing.title;
    const prompt = input.prompt !== undefined ? input.prompt.trim() : existing.prompt;
    const status = input.status ?? existing.status;

    if (!isValidTaskStatus(status)) {
      throw new Error(`Invalid task status: ${status}`);
    }

    validateTaskInput({ title, prompt, status });

    if (input.profileId !== undefined) {
      const profile = await this.db.getProfile(input.profileId);

      if (!profile) {
        throw new Error("Profile not found.");
      }
    }

    const statusChanged = status !== existing.status;
    let position = input.position;

    if (statusChanged && position === undefined) {
      position = await this.nextPosition(status as TaskStatus);
    } else if (position === undefined) {
      position = existing.position;
    }

    const updated: StoredTaskRecord = {
      ...existing,
      title,
      description:
        input.description !== undefined ? input.description.trim() : existing.description,
      prompt,
      profileId: input.profileId ?? existing.profileId,
      status,
      position,
      updatedAt: new Date().toISOString(),
    };

    await this.db.upsertTask(updated);

    if (
      status === "in_progress" &&
      statusChanged &&
      options?.triggerRun !== false &&
      this.taskRunner
    ) {
      void this.taskRunner.run(id).catch((error) => {
        console.error(`Task run failed for ${id}:`, error);
      });
    }

    return this.toStoredTask(updated);
  }

  async delete(id: string): Promise<boolean> {
    return this.db.deleteTask(id);
  }

  async createRun(taskId: string): Promise<TaskRunRecord> {
    const run = {
      id: createId("task_run"),
      taskId,
      status: "running" as const,
      startedAt: new Date().toISOString(),
      completedAt: null,
      output: null,
      error: null,
    };

    await this.db.insertTaskRun(run);
    return run;
  }

  async completeRun(
    runId: string,
    taskId: string,
    result: { output?: string; error?: string },
  ): Promise<void> {
    const runs = await this.db.listTaskRuns(taskId, 100);
    const existing = runs.find((run) => run.id === runId);

    if (!existing) {
      return;
    }

    await this.db.updateTaskRun({
      ...existing,
      status: result.error ? "failed" : "completed",
      completedAt: new Date().toISOString(),
      output: result.output ?? null,
      error: result.error ?? null,
    });
  }

  async listRuns(taskId: string, limit = 20): Promise<TaskRunRecord[]> {
    return this.db.listTaskRuns(taskId, limit);
  }

  async setTaskStatus(taskId: string, status: TaskStatus): Promise<void> {
    const existing = await this.db.getTask(taskId);

    if (!existing) {
      return;
    }

    await this.db.upsertTask({
      ...existing,
      status,
      position: await this.nextPosition(status),
      updatedAt: new Date().toISOString(),
    });
  }

  private async nextPosition(status: TaskStatus): Promise<number> {
    const tasks = await this.db.listTasks();
    const inColumn = tasks.filter((task) => task.status === status);

    if (inColumn.length === 0) {
      return 0;
    }

    return Math.max(...inColumn.map((task) => task.position)) + 1;
  }

  private toStoredTask(record: StoredTaskRecord): StoredTask {
    if (!isValidTaskStatus(record.status)) {
      throw new Error(`Invalid task status in database: ${record.status}`);
    }

    return {
      id: record.id,
      title: record.title,
      description: record.description,
      prompt: record.prompt,
      profileId: record.profileId,
      status: record.status,
      position: record.position,
      sessionId: record.sessionId ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
