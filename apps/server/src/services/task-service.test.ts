import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter, DEFAULT_PROFILE_ID } from "@tinyclaw/db";
import { TaskService } from "./task-service";
import { TaskRunner } from "./task-runner";

async function createTestDb() {
  const db = createInMemoryDatabaseAdapter();
  const now = new Date().toISOString();

  await db.upsertProfile({
    id: DEFAULT_PROFILE_ID,
    name: "Default Bot",
    systemPrompt: "",
    model: null,
    isSuper: false,
    createdAt: now,
    updatedAt: now,
  });

  return db;
}

describe("TaskService", () => {
  test("create defaults to backlog with position 0", async () => {
    const db = await createTestDb();
    const service = new TaskService(db);

    const task = await service.create({
      title: "Research competitors",
      prompt: "Find top 5 competitors",
    });

    expect(task.status).toBe("backlog");
    expect(task.position).toBe(0);
    expect(task.profileId).toBe(DEFAULT_PROFILE_ID);
  });

  test("create second task in backlog gets position 1", async () => {
    const db = await createTestDb();
    const service = new TaskService(db);

    await service.create({ title: "First", prompt: "Do first" });
    const second = await service.create({ title: "Second", prompt: "Do second" });

    expect(second.position).toBe(1);
  });

  test("create rejects empty title", async () => {
    const db = await createTestDb();
    const service = new TaskService(db);

    await expect(service.create({ title: "  ", prompt: "Do work" })).rejects.toThrow(
      "Task title is required.",
    );
  });

  test("create rejects unknown profile", async () => {
    const db = await createTestDb();
    const service = new TaskService(db);

    await expect(
      service.create({ title: "Task", prompt: "Do work" }, "profile_missing"),
    ).rejects.toThrow("Profile not found.");
  });

  test("list orders by status then position", async () => {
    const db = await createTestDb();
    const service = new TaskService(db);

    const first = await service.create({ title: "Backlog B", prompt: "b" });
    await service.create({ title: "Backlog A", prompt: "a" });
    await service.update(first.id, { status: "todo" });

    const tasks = await service.list();
    expect(tasks.map((task) => task.title)).toEqual(["Backlog A", "Backlog B"]);
  });

  test("update status backlog to todo appends position in todo column", async () => {
    const db = await createTestDb();
    const service = new TaskService(db);

    const task = await service.create({ title: "Move me", prompt: "work" });
    const updated = await service.update(task.id, { status: "todo" });

    expect(updated.status).toBe("todo");
    expect(updated.position).toBe(0);
  });

  test("update honors explicit position", async () => {
    const db = await createTestDb();
    const service = new TaskService(db);

    const task = await service.create({ title: "Reorder", prompt: "work" });
    const updated = await service.update(task.id, { position: 5 });

    expect(updated.position).toBe(5);
  });

  test("update not found throws", async () => {
    const db = await createTestDb();
    const service = new TaskService(db);

    await expect(service.update("task_missing", { title: "Nope" })).rejects.toThrow(
      "Task not found.",
    );
  });

  test("delete existing task returns true", async () => {
    const db = await createTestDb();
    const service = new TaskService(db);

    const task = await service.create({ title: "Delete me", prompt: "work" });
    const deleted = await service.delete(task.id);

    expect(deleted).toBe(true);
    expect(await service.get(task.id)).toBeNull();
  });

  test("delete missing task returns false", async () => {
    const db = await createTestDb();
    const service = new TaskService(db);

    expect(await service.delete("task_missing")).toBe(false);
  });
});

describe("TaskRunner", () => {
  test("writes completed run records and moves task to done", async () => {
    const db = await createTestDb();
    const service = new TaskService(db);

    const task = await service.create({
      title: "Run task",
      prompt: "Say hello",
    });

    const agentService = {
      runTaskPrompt: async () => "Hello from task",
    };

    const runner = new TaskRunner(service, agentService as never);
    service.setTaskRunner(runner);
    const result = await runner.run(task.id);

    expect(result.output).toBe("Hello from task");

    const runs = await service.listRuns(task.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe("completed");

    const updated = await service.get(task.id);
    expect(updated?.status).toBe("done");
  });

  test("writes failed run records and moves task to failed", async () => {
    const db = await createTestDb();
    const service = new TaskService(db);

    const task = await service.create({
      title: "Failing task",
      prompt: "Fail please",
    });

    const agentService = {
      runTaskPrompt: async () => {
        throw new Error("Provider offline");
      },
    };

    const runner = new TaskRunner(service, agentService as never);
    const result = await runner.run(task.id);

    expect(result.error).toBe("Provider offline");

    const runs = await service.listRuns(task.id);
    expect(runs[0]?.status).toBe("failed");

    const updated = await service.get(task.id);
    expect(updated?.status).toBe("failed");
  });

  test("skips duplicate run on same task", async () => {
    const db = await createTestDb();
    const service = new TaskService(db);

    const task = await service.create({
      title: "Concurrent task",
      prompt: "Run once",
    });

    let releasePrompt!: () => void;
    const promptGate = new Promise<string>((resolve) => {
      releasePrompt = () => resolve("done");
    });

    const agentService = {
      runTaskPrompt: async () => promptGate,
    };

    const runner = new TaskRunner(service, agentService as never);
    const first = runner.run(task.id);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = await runner.run(task.id);

    expect(second.skipped).toBe(true);

    releasePrompt();
    await first;
  });

  test("runs different tasks in parallel", async () => {
    const db = await createTestDb();
    const service = new TaskService(db);

    const taskA = await service.create({ title: "A", prompt: "a" });
    const taskB = await service.create({ title: "B", prompt: "b" });

    const active = new Set<string>();
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });

    const agentService = {
      runTaskPrompt: async (_taskId: string, _profileId: string, _prompt: string) => {
        active.add(_prompt);
        await gate;
        active.delete(_prompt);
        return _prompt;
      },
    };

    const runner = new TaskRunner(service, agentService as never);
    const runA = runner.run(taskA.id);
    const runB = runner.run(taskB.id);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(active.size).toBe(2);

    releaseGate();
    await Promise.all([runA, runB]);
  });
});
