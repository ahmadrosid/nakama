import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./actions";
import { parseWorkflowRecord } from "./workflow-ops";
import { WorkflowRunner } from "./workflow-runner";
import { WorkflowService } from "./workflow-service";

test("save action finishes updating before closing its database", async () => {
  const dir = await mkdtemp(join(tmpdir(), "workflow-save-"));
  const databasePath = join(dir, "data.sqlite");
  const service = new WorkflowService(databasePath, "org_a");

  try {
    expect(service.db.query("PRAGMA synchronous").get()).toEqual({
      synchronous: 3,
    });
    service.db.exec(
      await readFile(
        new URL("../migrations/001-workflows.sql", import.meta.url),
        "utf8"
      )
    );

    const context = {
      actionKey: "create_workflow",
      actor: { id: "admin", role: "admin" as const },
      apiVersion: 1 as const,
      databasePath,
      dataDir: dir,
      host: async ({ op }: { op: string }) =>
        op === "profiles" ? [{ id: "profile", isDefault: true }] : [],
      invocationId: "test",
      orgId: "org_a",
      pluginId: "workflows",
      pluginVersion: "1.0.1",
    };

    // SAFETY: The mock returns the profile and empty tool list used by both tested actions.
    const created = parseWorkflowRecord(
      await run(
        {
          name: "Original",
          steps: [{ id: "summary", kind: "summarize", prompt: "Summarize" }],
        },
        context
      )
    );

    await run(
      { name: "Updated", workflowId: created.id },
      {
        ...context,
        actionKey: "update_workflow",
      }
    );
    expect((await service.get(created.id))?.name).toBe("Updated");
    expect((await service.get(created.id))?.version).toBe(2);
  } finally {
    service.close();
    await rm(dir, { force: true, recursive: true });
  }
});

test("database prevents overlapping subprocess runs and imports transactionally", async () => {
  const dir = await mkdtemp(join(tmpdir(), "workflow-db-"));
  const first = new WorkflowService(join(dir, "data.sqlite"), "org_a");
  first.db.exec(
    await readFile(
      new URL("../migrations/001-workflows.sql", import.meta.url),
      "utf8"
    )
  );
  const second = new WorkflowService(join(dir, "data.sqlite"), "org_a");

  try {
    const workflow = await first.create(
      {
        name: "Test",
        steps: [{ id: "summary", kind: "summarize", prompt: "Summarize" }],
      },
      "profile",
      new Set()
    );

    const run = await first.createRun(workflow.id, {});
    await expect(second.createRun(workflow.id, {})).rejects.toThrow();
    await expect(second.delete(workflow.id)).rejects.toThrow();
    expect(await second.deleteRun(workflow.id, run.id)).toBe(false);
    await first.completeRun(run.id, workflow.id, { output: "done" });
    const next = await second.createRun(workflow.id, {});
    first.db
      .query("UPDATE runs SET lease_until = ? WHERE id = ?")
      .run(Date.now() - 1, next.id);
    expect((await second.listRuns(workflow.id))[0]?.status).toBe("failed");
    const legacy = { ...workflow, id: "legacy" };
    expect(() =>
      first.importLegacy([
        { runs: [], workflow: legacy },
        { runs: [], workflow: { ...legacy, id: "foreign", orgId: "org_b" } },
      ])
    ).toThrow();
    expect(await first.get("legacy")).toBeNull();
    expect(first.importLegacy([{ runs: [], workflow: legacy }]).imported).toBe(
      1
    );
    await first.delete("legacy");
    expect(first.importLegacy([{ runs: [], workflow: legacy }]).imported).toBe(
      0
    );
    expect(await second.delete(workflow.id)).toBe(true);
    expect(await first.listRuns(workflow.id)).toEqual([]);
  } finally {
    first.close();
    second.close();
    await rm(dir, { force: true, recursive: true });
  }
});

test("separate processes start runs of different workflows at once", async () => {
  const dir = await mkdtemp(join(tmpdir(), "workflow-race-"));
  const databasePath = join(dir, "data.sqlite");
  const service = new WorkflowService(databasePath, "org_a");
  service.db.exec(
    await readFile(
      new URL("../migrations/001-workflows.sql", import.meta.url),
      "utf8"
    )
  );

  try {
    const ids: string[] = [];

    for (let index = 0; index < 4; index++) {
      const workflow = await service.create(
        {
          name: `Workflow ${index}`,
          steps: [{ id: "summary", kind: "summarize", prompt: "Summarize" }],
        },
        "profile",
        new Set()
      );

      ids.push(workflow.id);
    }

    const modulePath = new URL("./workflow-service.ts", import.meta.url)
      .pathname;

    const startAt = Date.now() + 300;

    const script = `
      const { WorkflowService } = await import(${JSON.stringify(modulePath)});
      const [path, workflowId, startAt] = process.argv.slice(1);
      const service = new WorkflowService(path, "org_a");
      while (Date.now() < Number(startAt)) {}
      try {
        await service.createRun(workflowId, {});
      } finally {
        service.close();
      }
    `;

    const exitCodes = await Promise.all(
      ids.map(
        (id) =>
          Bun.spawn(["bun", "-e", script, databasePath, id, String(startAt)], {
            stderr: "ignore",
            stdout: "ignore",
          }).exited
      )
    );

    expect(exitCodes).toEqual([0, 0, 0, 0]);

    for (const id of ids) {
      expect(await service.listRuns(id)).toHaveLength(1);
    }
  } finally {
    service.close();
    await rm(dir, { force: true, recursive: true });
  }
});

test("create and update reject malformed tool inputs without persisting changes", async () => {
  const service = new WorkflowService(":memory:", "org_a");
  service.db.exec(
    await readFile(
      new URL("../migrations/001-workflows.sql", import.meta.url),
      "utf8"
    )
  );
  const allowedTools = new Set(["web_fetch"]);

  const summary = {
    id: "summary",
    kind: "summarize",
    prompt: "Summarize",
  } as const;

  const validSteps = [
    {
      id: "fetch",
      input: { url: "{{input.url}}" },
      kind: "tool",
      tool: "web_fetch",
    } as const,
    summary,
  ];

  try {
    for (const fields of [
      { args: { url: "https://example.com" } },
      {},
      { input: null },
      { input: [] },
      { input: "{}" },
      { input: 42 },
      { input: false },
    ]) {
      // SAFETY: Fixed malformed fixtures exercise service.create's runtime validator.
      const steps = [
        { id: "fetch", kind: "tool", tool: "web_fetch", ...fields },
        summary,
      ] as never;

      await expect(
        service.create({ name: "Invalid", steps }, "profile", allowedTools)
      ).rejects.toThrow();
      expect(await service.listForOrg()).toEqual([]);

      const workflow = await service.create(
        { name: "Valid", steps: validSteps },
        "profile",
        allowedTools
      );

      await expect(
        service.update(workflow.id, { steps }, allowedTools)
      ).rejects.toThrow();
      expect((await service.get(workflow.id))?.steps).toEqual(validSteps);
      await service.delete(workflow.id);
    }

    const workflow = await service.create(
      {
        name: "No arguments",
        steps: [
          { id: "fetch", input: {}, kind: "tool", tool: "web_fetch" },
          summary,
        ],
      },
      "profile",
      allowedTools
    );

    expect((await service.get(workflow.id))?.steps[0]).toEqual({
      id: "fetch",
      input: {},
      kind: "tool",
      tool: "web_fetch",
    });
  } finally {
    service.close();
  }
});

test("a run that expires mid-run stays failed when the runner finishes late", async () => {
  const service = new WorkflowService(":memory:", "org_a");
  service.db.exec(
    await readFile(
      new URL("../migrations/001-workflows.sql", import.meta.url),
      "utf8"
    )
  );

  try {
    const workflow = await service.create(
      {
        name: "Slow",
        steps: [{ id: "summary", kind: "summarize", prompt: "Summarize" }],
      },
      "profile",
      new Set()
    );

    const runner = new WorkflowRunner(service, {
      executeTool: async () => ({}),
      runWorkflowSummarize: async () => {
        service.db.query("UPDATE runs SET lease_until = ?").run(Date.now() - 1);
        await service.listRuns(workflow.id);

        return "late output";
      },
    });

    const result = await runner.run(workflow.id);
    const [stored] = await service.listRuns(workflow.id);

    expect(result.error).toBeDefined();
    expect(result.output).toBeUndefined();
    expect(stored?.status).toBe("failed");
    expect(stored?.output).toBeNull();
  } finally {
    service.close();
  }
});

test("a filter check ends the run as skipped while a plain check still fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "workflow-filter-"));
  const databasePath = join(dir, "data.sqlite");
  const service = new WorkflowService(databasePath, "org_a");

  try {
    service.db.exec(
      await readFile(
        new URL("../migrations/001-workflows.sql", import.meta.url),
        "utf8"
      )
    );

    let summaries = 0;

    const context = {
      actionKey: "create_workflow",
      actor: { id: "admin", role: "admin" as const },
      apiVersion: 1 as const,
      databasePath,
      dataDir: dir,
      host: async ({ op }: { op: string }) => {
        if (op === "summarize") {
          summaries += 1;

          return "Summary";
        }

        return op === "profiles" ? [{ id: "profile", isDefault: true }] : [];
      },
      invocationId: "test",
      orgId: "org_a",
      pluginId: "workflows",
      pluginVersion: "1.0.1",
    };

    const create = async (onFail?: "fail" | "skip") => {
      const created = parseWorkflowRecord(
        await run(
          {
            name: "GitHub mail",
            steps: [
              {
                id: "from_github",
                kind: "compare",
                left: "{{input.from}}",
                onFail,
                op: "contains",
                right: "github.com",
              },
              { id: "note", kind: "template", template: "{{input.from}}" },
              { id: "summary", kind: "summarize", prompt: "Summarize" },
            ],
          },
          context
        )
      );

      return String(created.id);
    };

    const runWorkflow = async (workflowId: string, from: string) =>
      parseWorkflowRecord(
        await run(
          { input: { from }, workflowId },
          { ...context, actionKey: "run_workflow" }
        )
      );

    const filter = await create("skip");
    const skipped = await runWorkflow(filter, "Stripe <billing@stripe.com>");
    const skippedRun = parseWorkflowRecord(skipped.run);

    expect(skipped.status).toBe("skipped");
    expect(skipped.error).toBeUndefined();
    expect(skippedRun.status).toBe("skipped");
    expect(skippedRun.error).toBeNull();
    expect(
      (await service.getRun(filter, String(skippedRun.id)))?.steps?.map(
        (step) => [step.stepId, step.status, step.error ?? null]
      )
    ).toEqual([["from_github", "skipped", null]]);
    expect(summaries).toBe(0);

    const passed = await runWorkflow(filter, "GitHub <noreply@github.com>");
    expect(passed.status).toBe("completed");
    expect(passed.output).toBe("Summary");
    expect(summaries).toBe(1);

    for (const onFail of [undefined, "fail"] as const) {
      const plain = await create(onFail);
      const failed = await runWorkflow(plain, "Stripe <billing@stripe.com>");
      const failedRun = parseWorkflowRecord(failed.run);

      expect(failed.status).toBe("failed");
      expect(failedRun.status).toBe("failed");
      expect(failedRun.error).toEqual(expect.any(String));
      expect(
        (await service.getRun(plain, String(failedRun.id)))?.steps?.map(
          (step) => step.status
        )
      ).toEqual(["failed"]);
    }

    expect(summaries).toBe(1);
  } finally {
    service.close();
    await rm(dir, { force: true, recursive: true });
  }
});
