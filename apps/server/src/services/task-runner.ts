import type { AgentService } from "./agent-service";
import type { TaskService } from "./task-service";

export class TaskRunner {
  private readonly running = new Set<string>();

  constructor(
    private readonly taskService: TaskService,
    private readonly agentService: AgentService,
  ) {}

  async run(taskId: string): Promise<{ output?: string; error?: string; skipped?: boolean }> {
    if (this.running.has(taskId)) {
      return { skipped: true, error: "Task is already running." };
    }

    this.running.add(taskId);

    try {
      const task = await this.taskService.get(taskId);

      if (!task) {
        throw new Error("Task not found.");
      }

      const run = await this.taskService.createRun(taskId);

      try {
        const output = await this.agentService.runTaskPrompt(taskId, task.profileId, task.prompt);

        await this.taskService.completeRun(run.id, taskId, { output });
        await this.taskService.setTaskStatus(taskId, "done");
        return { output };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.taskService.completeRun(run.id, taskId, { error: message });
        await this.taskService.setTaskStatus(taskId, "failed");
        return { error: message };
      }
    } finally {
      this.running.delete(taskId);
    }
  }

  isRunning(taskId: string): boolean {
    return this.running.has(taskId);
  }

  getActiveRunCount(): number {
    return this.running.size;
  }
}
