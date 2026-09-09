import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkflowService } from "./workflow-service";

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
