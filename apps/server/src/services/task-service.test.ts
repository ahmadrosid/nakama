import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { TaskService } from "./task-service";
import { TaskRunner } from "./task-runner";

const ORG_ID = "org_test";
const PROFILE_ID = "profile_default";

async function createTestDb() {
  const db = createInMemoryDatabaseAdapter();
  const now = new Date().toISOString();

  await db.upsertOrganization({
    id: ORG_ID,
    name: "Test Org",
    slug: "test-org",
    createdAt: now,
    updatedAt: now,
  });

  await db.upsertProfile({
    id: PROFILE_ID,
    name: "Default Bot",
    systemPrompt: "",
    model: null,
    isSuper: false,
    orgId: ORG_ID,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  });

  return db;
}

describe("TaskService", () => {
  test("create defaults to backlog with position 0", async () => {
    const db = await createTestDb();
    const service = new TaskService(db);

    const task = await service.create(ORG_ID, {
      title: "Research competitors",
      prompt: "Find top 5 competitors",
    });

    expect(task.status).toBe("backlog");
    expect(task.position).toBe(0);
    expect(task.profileId).toBe(PROFILE_ID);
  });

  test("create second task in backlog gets position 1", async () => {
    const db = await createTestDb();
    const service = new TaskService(db);

    await service.create(ORG_ID, { title: "First", prompt: "Do first" });
    const second = await service.create(ORG_ID, { title: "Second", prompt: "Do second" });

    expect(second.position).toBe(1);
  });

  test("create rejects empty title", async () => {
    const db = await createTestDb();
    const service = new TaskService(db);

    await expect(
      service.create(ORG_ID, { title: "  ", prompt: "Do work" }),
    ).rejects.toThrow("Task title is required.");
  });

  test("create rejects unknown profile", async () => {
    const db = await createTestDb();
    const service = new TaskService(db);

    await expect(
      service.create(ORG_ID, { title: "Task", prompt: "Do work" }, "profile_missing"),
    ).rejects.toThrow("Profile not found.");
  });

  test("list orders by status then position", async () => {
    const db = await createTestDb();
    const service = new TaskService(db);

    const first = await service.create(ORG_ID, { title: "Backlog B", prompt: "b" });
    await service.create(ORG_ID, { title: "Backlog A", prompt: "a" });
    await service.update(first.id, ORG_ID, { status: "todo" });

    const tasks = await service.listForOrg(ORG_ID);
    expect(tasks.map((task) => task.title)).toEqual(["Backlog A", "Backlog B"]);
  });

  test("lists tasks only for the active org", async () => {
    const db = await createTestDb();
    const service = new TaskService(db);
    const now = new Date().toISOString();
    const otherOrgId = "org_other";
    const otherProfileId = "profile_other";

    await db.upsertOrganization({
      id: otherOrgId,
      name: "Other Org",
      slug: "other-org",
      createdAt: now,
      updatedAt: now,
    });

    await db.upsertProfile({
      id: otherProfileId,
      name: "Other Bot",
      systemPrompt: "",
      model: null,
      isSuper: false,
      orgId: otherOrgId,
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    });

    const orgTask = await service.create(ORG_ID, {
      title: "Org task",
      prompt: "Run",
    });

    await service.create(otherOrgId, {
      title: "Other org task",
      prompt: "Run",
    });

    const listed = await service.listForOrg(ORG_ID);
    expect(listed.map((entry) => entry.id)).toEqual([orgTask.id]);

    expect(await service.get(orgTask.id, ORG_ID)).not.toBeNull();
    expect(await service.get(orgTask.id, otherOrgId)).toBeNull();
  });

  test("update status backlog to todo appends position in todo column", async () => {
    const db = await createTestDb();
    const service = new TaskService(db);

    const task = await service.create(ORG_ID, { title: "Move me", prompt: "work" });
    const updated = await service.update(task.id, ORG_ID, { status: "todo" });

    expect(updated.status).toBe("todo");
    expect(updated.position).toBe(0);
  });

  test("update honors explicit position", async () => {
    const db = await createTestDb();
    const service = new TaskService(db);

    const task = await service.create(ORG_ID, { title: "Reorder", prompt: "work" });
    const updated = await service.update(task.id, ORG_ID, { position: 5 });

    expect(updated.position).toBe(5);
  });

  test("update not found throws", async () => {
    const db = await createTestDb();
    const service = new TaskService(db);

    await expect(service.update("task_missing", ORG_ID, { title: "Nope" })).rejects.toThrow(
      "Task not found.",
    );
  });

  test("delete existing task returns true", async () => {
    const db = await createTestDb();
    const service = new TaskService(db);

    const task = await service.create(ORG_ID, { title: "Delete me", prompt: "work" });
    const deleted = await service.delete(task.id, ORG_ID);

    expect(deleted).toBe(true);
    expect(await service.get(task.id, ORG_ID)).toBeNull();
  });

  test("delete missing task returns false", async () => {
    const db = await createTestDb();
    const service = new TaskService(db);

    expect(await service.delete("task_missing", ORG_ID)).toBe(false);
  });
});

describe("TaskRunner", () => {
  test("writes completed run records and moves task to done", async () => {
    const db = await createTestDb();
    const service = new TaskService(db);

    const task = await service.create(ORG_ID, {
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

    const task = await service.create(ORG_ID, {
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

    const task = await service.create(ORG_ID, {
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

    const taskA = await service.create(ORG_ID, { title: "A", prompt: "a" });
    const taskB = await service.create(ORG_ID, { title: "B", prompt: "b" });

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
