import type {
  CreateTaskRequest,
  StoredTask,
  TaskRunRecord,
  TaskStatus,
  UpdateTaskRequest,
} from "@nakama/core";
import { createId } from "@nakama/core";
import type { DatabaseAdapter, StoredTaskRecord } from "@nakama/db";
import { isValidTaskStatus, validateTaskInput } from "./task-validate";
import type { TaskRunner } from "./task-runner";

export class TaskService {
  private taskRunner: TaskRunner | null = null;

  constructor(private readonly db: DatabaseAdapter) {}

  setTaskRunner(taskRunner: TaskRunner): void {
    this.taskRunner = taskRunner;
  }

  async listForOrg(orgId: string): Promise<StoredTask[]> {
    const records = await this.db.listTasksForOrg(orgId);
    return records.map((record) => this.toStoredTask(record));
  }

  async get(id: string, orgId?: string): Promise<StoredTask | null> {
    const record = await this.db.getTask(id);
    if (!record || (orgId && record.orgId !== orgId)) {
      return null;
    }

    return this.toStoredTask(record);
  }

  async create(
    orgId: string,
    input: CreateTaskRequest,
    profileIdOverride?: string,
  ): Promise<StoredTask> {
    const status = input.status ?? "backlog";
    validateTaskInput({
      title: input.title,
      prompt: input.prompt,
      status,
    });

    const profileId = await this.resolveProfileId(
      orgId,
      profileIdOverride ?? input.profileId,
    );

    const now = new Date().toISOString();
    const task: StoredTaskRecord = {
      id: createId("task"),
      title: input.title.trim(),
      description: input.description?.trim() ?? "",
      prompt: input.prompt.trim(),
      profileId,
      orgId,
      status,
      position: await this.nextPosition(orgId, status),
      createdAt: now,
      updatedAt: now,
    };

    await this.db.upsertTask(task);
    return this.toStoredTask(task);
  }

  async update(
    id: string,
    orgId: string,
    input: UpdateTaskRequest,
    options?: { triggerRun?: boolean },
  ): Promise<StoredTask> {
    const existing = await this.db.getTask(id);

    if (!existing || existing.orgId !== orgId) {
      throw new Error("Task not found.");
    }

    const title = input.title !== undefined ? input.title.trim() : existing.title;
    const prompt = input.prompt !== undefined ? input.prompt.trim() : existing.prompt;
    const status = input.status ?? existing.status;

    if (!isValidTaskStatus(status)) {
      throw new Error(`Invalid task status: ${status}`);
    }

    validateTaskInput({ title, prompt, status });

    let profileId = existing.profileId;

    if (input.profileId !== undefined) {
      profileId = await this.resolveProfileId(orgId, input.profileId);
    }

    const statusChanged = status !== existing.status;
    let position = input.position;

    if (statusChanged && position === undefined) {
      position = await this.nextPosition(orgId, status as TaskStatus);
    } else if (position === undefined) {
      position = existing.position;
    }

    const updated: StoredTaskRecord = {
      ...existing,
      title,
      description:
        input.description !== undefined ? input.description.trim() : existing.description,
      prompt,
      profileId,
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

  async delete(id: string, orgId: string): Promise<boolean> {
    const existing = await this.db.getTask(id);
    if (!existing || existing.orgId !== orgId) {
      return false;
    }

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

  async listRuns(taskId: string, orgId?: string, limit = 20): Promise<TaskRunRecord[]> {
    const task = orgId ? await this.get(taskId, orgId) : await this.db.getTask(taskId);

    if (!task) {
      throw new Error("Task not found.");
    }

    return this.db.listTaskRuns(taskId, limit);
  }

  async setTaskStatus(taskId: string, status: TaskStatus): Promise<void> {
    const existing = await this.db.getTask(taskId);

    if (!existing?.orgId) {
      return;
    }

    await this.db.upsertTask({
      ...existing,
      status,
      position: await this.nextPosition(existing.orgId, status),
      updatedAt: new Date().toISOString(),
    });
  }

  private async resolveProfileId(orgId: string, profileId?: string): Promise<string> {
    const trimmed = profileId?.trim();

    if (trimmed) {
      const profile = await this.db.getProfileForOrg(trimmed, orgId);
      if (profile) {
        return profile.id;
      }

      throw new Error("Profile not found.");
    }

    const defaultProfile = await this.db.getDefaultProfileForOrg(orgId);
    if (!defaultProfile) {
      throw new Error("No default profile exists for this organization.");
    }

    return defaultProfile.id;
  }

  private async nextPosition(orgId: string, status: TaskStatus): Promise<number> {
    const tasks = await this.db.listTasksForOrg(orgId);
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
