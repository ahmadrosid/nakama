import { Database } from "bun:sqlite";
import type {
  CreateWorkflowRequest,
  StoredWorkflow,
  UpdateWorkflowRequest,
  WorkflowRunRecord,
  WorkflowRunStepRecord,
  WorkflowStep,
} from "@nakama/core/contract";
import { validateWorkflowSteps } from "./workflow-ops";
import { validateWorkflowInput } from "./workflow-validate";

export class WorkflowService {
  readonly db: Database;
  constructor(
    path: string,
    private readonly orgId: string
  ) {
    this.db = new Database(path, { strict: true });
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  }
  close() {
    this.db.close();
  }
  async listForOrg(): Promise<StoredWorkflow[]> {
    return this.db
      .query<{ data: string }, []>(
        "SELECT data FROM workflows ORDER BY rowid DESC"
      )
      .all()
      .map((row) => JSON.parse(row.data));
  }
  async get(id: string): Promise<StoredWorkflow | null> {
    const row = this.db
      .query<{ data: string }, [string]>(
        "SELECT data FROM workflows WHERE id = ?"
      )
      .get(id);
    return row ? JSON.parse(row.data) : null;
  }
  async create(
    input: CreateWorkflowRequest,
    profileId: string,
    allowedTools: Set<string>
  ) {
    validateWorkflowInput(input);
    validateWorkflowSteps(input.steps, allowedTools);
    const now = new Date().toISOString();
    const workflow: StoredWorkflow = {
      ...input,
      createdAt: now,
      description: input.description?.trim() || input.name.trim(),
      enabled: input.enabled ?? true,
      id: `workflow_${crypto.randomUUID()}`,
      name: input.name.trim(),
      orgId: this.orgId,
      profileId,
      steps: input.steps.map((step) => ({ ...step, id: step.id.trim() })),
      updatedAt: now,
      version: 1,
    };
    this.db
      .query("INSERT INTO workflows VALUES (?, ?)")
      .run(workflow.id, JSON.stringify(workflow));
    return workflow;
  }
  async update(
    id: string,
    input: UpdateWorkflowRequest,
    allowedTools: Set<string>
  ) {
    const existing = await this.get(id);
    if (!existing) {
      throw new Error("Workflow not found.");
    }
    const workflow = {
      ...existing,
      ...input,
      id,
      orgId: this.orgId,
      updatedAt: new Date().toISOString(),
      version: existing.version + 1,
    };
    validateWorkflowInput(workflow);
    validateWorkflowSteps(workflow.steps, allowedTools);
    this.db
      .query("UPDATE workflows SET data = ? WHERE id = ?")
      .run(JSON.stringify(workflow), id);
    return workflow;
  }
  async delete(id: string) {
    this.expireRuns();
    return this.db.transaction(() => {
      if (
        this.db
          .query(
            "SELECT id FROM runs WHERE workflow_id = ? AND lease_until IS NOT NULL"
          )
          .get(id)
      ) {
        throw new Error("Workflow is running.");
      }
      return (
        this.db.query("DELETE FROM workflows WHERE id = ?").run(id).changes > 0
      );
    })();
  }
  private expireRuns() {
    this.db.transaction(() => {
      const expired = this.db
        .query<{ id: string; data: string }, [number]>(
          "SELECT id, data FROM runs WHERE lease_until < ?"
        )
        .all(Date.now());
      for (const row of expired) {
        const data = {
          ...JSON.parse(row.data),
          completedAt: new Date().toISOString(),
          error: "Workflow execution was interrupted.",
          status: "failed",
        };
        this.db
          .query("UPDATE runs SET data = ?, lease_until = NULL WHERE id = ?")
          .run(JSON.stringify(data), row.id);
      }
    })();
  }
  async listRuns(workflowId: string): Promise<WorkflowRunRecord[]> {
    this.expireRuns();
    return this.db
      .query<{ data: string }, [string]>(
        "SELECT data FROM runs WHERE workflow_id = ? ORDER BY rowid DESC LIMIT 20"
      )
      .all(workflowId)
      .map((row) => {
        const run = JSON.parse(row.data);
        return { ...run, steps: this.steps(run.id) };
      });
  }
  private steps(runId: string): WorkflowRunStepRecord[] {
    return this.db
      .query<{ data: string }, [string]>(
        "SELECT data FROM steps WHERE run_id = ? ORDER BY position"
      )
      .all(runId)
      .map((row) => JSON.parse(row.data));
  }
  async getRun(
    workflowId: string,
    runId: string
  ): Promise<WorkflowRunRecord | null> {
    this.expireRuns();
    const row = this.db
      .query<{ data: string }, [string, string]>(
        "SELECT data FROM runs WHERE workflow_id = ? AND id = ?"
      )
      .get(workflowId, runId);
    return row ? { ...JSON.parse(row.data), steps: this.steps(runId) } : null;
  }
  async deleteRun(workflowId: string, runId: string) {
    this.expireRuns();
    return (
      this.db
        .query(
          "DELETE FROM runs WHERE id = ? AND workflow_id = ? AND lease_until IS NULL"
        )
        .run(runId, workflowId).changes > 0
    );
  }
  async createRun(
    workflowId: string,
    input: Record<string, unknown>
  ): Promise<WorkflowRunRecord> {
    this.expireRuns();
    const run: WorkflowRunRecord = {
      completedAt: null,
      error: null,
      id: `wfrun_${crypto.randomUUID()}`,
      input,
      output: null,
      startedAt: new Date().toISOString(),
      status: "running",
      workflowId,
    };
    this.db.transaction(() => {
      if (
        this.db
          .query(
            "SELECT id FROM runs WHERE workflow_id = ? AND lease_until IS NOT NULL"
          )
          .get(workflowId)
      ) {
        throw new Error("Workflow is already running.");
      }
      this.db
        .query("INSERT INTO runs VALUES (?, ?, ?, ?)")
        .run(run.id, workflowId, JSON.stringify(run), Date.now() + 300_000);
      this.db
        .query(
          "UPDATE workflows SET data = json_set(data, '$.lastRunAt', ?) WHERE id = ?"
        )
        .run(run.startedAt, workflowId);
    })();
    return run;
  }
  async createRunStep(runId: string, step: WorkflowStep, position: number) {
    const record: WorkflowRunStepRecord = {
      completedAt: null,
      error: null,
      id: `wfstep_${crypto.randomUUID()}`,
      input: null,
      kind: step.kind,
      output: null,
      runId,
      startedAt: new Date().toISOString(),
      status: "running",
      stepId: step.id,
    };
    this.db
      .query("INSERT INTO steps VALUES (?, ?, ?, ?)")
      .run(record.id, runId, position, JSON.stringify(record));
    return record;
  }
  async updateRunStep(
    runId: string,
    id: string,
    result: {
      error?: string;
      input?: unknown;
      output?: unknown;
      status: WorkflowRunStepRecord["status"];
    }
  ) {
    const record = this.steps(runId).find((step) => step.id === id);
    if (!record) {
      throw new Error("Workflow run step not found.");
    }
    this.db.query("UPDATE steps SET data = ? WHERE id = ? AND run_id = ?").run(
      JSON.stringify({
        ...record,
        ...result,
        completedAt: new Date().toISOString(),
      }),
      id,
      runId
    );
  }
  async completeRun(
    id: string,
    workflowId: string,
    result: { error?: string; output?: string }
  ): Promise<WorkflowRunRecord> {
    const row = this.db
      .query<{ data: string }, [string, string]>(
        "SELECT data FROM runs WHERE id = ? AND workflow_id = ?"
      )
      .get(id, workflowId);
    if (!row) {
      throw new Error("Workflow run not found.");
    }
    const run = {
      ...JSON.parse(row.data),
      ...result,
      completedAt: new Date().toISOString(),
      status: result.error ? "failed" : "completed",
    };
    this.db
      .query("UPDATE runs SET data = ?, lease_until = NULL WHERE id = ?")
      .run(JSON.stringify(run), id);
    return { ...run, steps: this.steps(id) };
  }
  importLegacy(
    workflows: Array<{ workflow: StoredWorkflow; runs: WorkflowRunRecord[] }>
  ) {
    return this.db.transaction(() => {
      if (
        this.db
          .query("SELECT value FROM metadata WHERE key = 'legacy_imported'")
          .get()
      ) {
        return { imported: 0 };
      }
      let imported = 0;
      for (const { workflow, runs } of workflows) {
        if (workflow.orgId !== this.orgId) {
          throw new Error("Workflow organization mismatch.");
        }
        const inserted = this.db
          .query("INSERT OR IGNORE INTO workflows VALUES (?, ?)")
          .run(workflow.id, JSON.stringify(workflow));
        if (!inserted.changes) {
          continue;
        }
        imported++;
        for (const run of runs) {
          if (run.workflowId !== workflow.id) {
            throw new Error("Workflow run mismatch.");
          }
          const { steps = [], ...data } = run;
          if (data.status === "running") {
            Object.assign(data, {
              completedAt: new Date().toISOString(),
              error: "Run interrupted before import.",
              status: "failed",
            });
          }
          this.db
            .query("INSERT INTO runs VALUES (?, ?, ?, NULL)")
            .run(run.id, workflow.id, JSON.stringify(data));
          for (const [position, step] of steps.entries()) {
            this.db
              .query("INSERT INTO steps VALUES (?, ?, ?, ?)")
              .run(step.id, run.id, position, JSON.stringify(step));
          }
        }
      }
      this.db
        .query("INSERT INTO metadata VALUES ('legacy_imported', 'true')")
        .run();
      return { imported };
    })();
  }
}
