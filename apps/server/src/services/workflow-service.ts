import type {
  CreateWorkflowRequest,
  StoredWorkflow,
  UpdateWorkflowRequest,
  WorkflowRunRecord,
  WorkflowRunStepRecord,
  WorkflowStep,
} from "@nakama/core";
import {
  createId,
  NakamaApiError,
  validateWorkflowInput,
  validateWorkflowSteps,
} from "@nakama/core";
import { canAccessSuperBotProfile } from "@nakama/core/profiles";
import {
  type DatabaseAdapter,
  DatabaseWorkflowStore,
  type StoredWorkflowRunRecord,
  type StoredWorkflowRunStepRecord,
} from "@nakama/db";

export type ProfileAccess = Parameters<typeof canAccessSuperBotProfile>[0];

export class WorkflowService {
  private readonly store: DatabaseWorkflowStore;
  private readonly db: DatabaseAdapter;

  constructor(db: DatabaseAdapter) {
    this.db = db;
    this.store = new DatabaseWorkflowStore(db);
  }

  async listForOrg(orgId: string): Promise<StoredWorkflow[]> {
    const workflows = await this.store.listForOrg(orgId);
    return Promise.all(
      workflows.map((workflow) => this.enrichWorkflow(workflow))
    );
  }

  async get(id: string, orgId?: string): Promise<StoredWorkflow | null> {
    const workflow = await this.store.get(id);
    if (!workflow) {
      return null;
    }
    if (orgId && workflow.orgId !== orgId) {
      return null;
    }

    return this.enrichWorkflow(workflow);
  }

  async create(
    orgId: string,
    input: CreateWorkflowRequest,
    profileIdOverride?: string,
    access?: ProfileAccess,
    allowedTools?: Set<string>
  ): Promise<StoredWorkflow> {
    validateWorkflowInput({
      name: input.name,
      steps: input.steps,
    });

    const profileId = await this.resolveProfileId(
      orgId,
      profileIdOverride ?? input.profileId,
      access
    );
    validateWorkflowSteps(input.steps, allowedTools ?? new Set());
    const steps = normalizeWorkflowSteps(input.steps);

    const now = new Date().toISOString();
    const workflow: StoredWorkflow = {
      createdAt: now,
      description: input.description?.trim() || input.name.trim(),
      enabled: input.enabled ?? true,
      id: createId("workflow"),
      name: input.name.trim(),
      orgId,
      profileId,
      steps,
      updatedAt: now,
      version: 1,
    };

    await this.store.save(workflow);
    return this.enrichWorkflow(workflow);
  }

  async update(
    id: string,
    orgId: string,
    input: UpdateWorkflowRequest,
    access?: ProfileAccess,
    allowedTools?: Set<string>
  ): Promise<StoredWorkflow> {
    const existing = await this.get(id, orgId);

    if (!existing) {
      throw new Error("Workflow not found.");
    }

    validateWorkflowInput({
      name: input.name?.trim() || existing.name,
      steps: input.steps ?? existing.steps,
    });

    let profileId = existing.profileId;
    if (input.profileId !== undefined) {
      if (!input.profileId.trim()) {
        throw new Error("Profile id is required.");
      }
      profileId = await this.resolveProfileId(orgId, input.profileId, access);
    }

    validateWorkflowSteps(
      input.steps ?? existing.steps,
      allowedTools ?? new Set()
    );
    const steps = normalizeWorkflowSteps(input.steps ?? existing.steps);

    const updated: StoredWorkflow = {
      ...existing,
      description: input.description?.trim() ?? existing.description,
      enabled: input.enabled ?? existing.enabled,
      name: input.name?.trim() || existing.name,
      profileId,
      steps,
      updatedAt: new Date().toISOString(),
      version: existing.version + 1,
    };

    await this.store.save(updated);
    return this.enrichWorkflow(updated);
  }

  async delete(id: string, orgId: string): Promise<boolean> {
    const existing = await this.get(id, orgId);
    if (!existing) {
      return false;
    }

    return this.store.delete(id);
  }

  async listRuns(
    workflowId: string,
    orgId?: string,
    limit = 20
  ): Promise<WorkflowRunRecord[]> {
    const workflow = orgId
      ? await this.get(workflowId, orgId)
      : await this.store.get(workflowId);

    if (!workflow) {
      throw new Error("Workflow not found.");
    }

    const runs = await this.db.listWorkflowRuns(workflowId, limit);
    return Promise.all(
      runs.map(async (run) => {
        const steps = await this.db.listWorkflowRunSteps(run.id);
        return toRunRecord(run, steps);
      })
    );
  }

  async getRun(
    workflowId: string,
    runId: string,
    orgId: string,
    includeSteps = true
  ): Promise<WorkflowRunRecord | null> {
    const workflow = await this.get(workflowId, orgId);
    if (!workflow) {
      return null;
    }

    const run = await this.db.getWorkflowRun(workflowId, runId);
    if (!run) {
      return null;
    }

    return toRunRecord(
      run,
      includeSteps ? await this.db.listWorkflowRunSteps(runId) : undefined
    );
  }

  async deleteRun(
    workflowId: string,
    runId: string,
    orgId: string
  ): Promise<boolean> {
    const workflow = await this.get(workflowId, orgId);
    if (!workflow) {
      throw new Error("Workflow not found.");
    }

    return this.db.deleteWorkflowRun(workflowId, runId);
  }

  async createRun(
    workflowId: string,
    input: Record<string, unknown> | null
  ): Promise<WorkflowRunRecord> {
    const run: StoredWorkflowRunRecord = {
      completedAt: null,
      error: null,
      id: createId("wfrun"),
      input: input ? JSON.stringify(input) : null,
      output: null,
      startedAt: new Date().toISOString(),
      status: "running",
      workflowId,
    };

    await this.db.insertWorkflowRun(run);
    return toRunRecord(run);
  }

  async createRunStep(
    runId: string,
    step: WorkflowStep,
    position: number
  ): Promise<WorkflowRunStepRecord> {
    const record: StoredWorkflowRunStepRecord = {
      completedAt: null,
      error: null,
      id: createId("wfstep"),
      input: null,
      kind: step.kind,
      output: null,
      position,
      runId,
      startedAt: new Date().toISOString(),
      status: "running",
      stepId: step.id,
    };

    await this.db.insertWorkflowRunStep(record);
    return toStepRecord(record);
  }

  async updateRunStep(
    runId: string,
    stepRecordId: string,
    result: {
      error?: string;
      input?: unknown;
      output?: unknown;
      status: WorkflowRunStepRecord["status"];
    }
  ): Promise<void> {
    const steps = await this.db.listWorkflowRunSteps(runId);
    const stepRecord = steps.find((step) => step.id === stepRecordId);
    if (!stepRecord) {
      throw new Error("Workflow run step not found.");
    }

    await this.db.updateWorkflowRunStep({
      ...stepRecord,
      completedAt: new Date().toISOString(),
      error: result.error ?? null,
      input: serializeJson(result.input),
      output: serializeJson(result.output),
      status: result.status,
    });
  }

  async completeRun(
    runId: string,
    workflowId: string,
    result: { error?: string; output?: string }
  ): Promise<WorkflowRunRecord> {
    const run = await this.db.getWorkflowRun(workflowId, runId);
    if (!run) {
      throw new Error("Workflow run not found.");
    }

    const updated: StoredWorkflowRunRecord = {
      ...run,
      completedAt: new Date().toISOString(),
      error: result.error ?? null,
      output: result.output ?? null,
      status: result.error ? "failed" : "completed",
    };

    await this.db.updateWorkflowRun(updated);
    const steps = await this.db.listWorkflowRunSteps(runId);
    return toRunRecord(updated, steps);
  }

  private async resolveProfileId(
    orgId: string,
    profileId?: string,
    access?: ProfileAccess
  ): Promise<string> {
    const trimmed = profileId?.trim();

    if (trimmed) {
      const profile = await this.db.getProfileForOrg(trimmed, orgId);
      if (profile) {
        if (profile.isSuper && !canAccessSuperBotProfile(access ?? {})) {
          throw new NakamaApiError(
            "Super Bot is only available to org admins.",
            403
          );
        }
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

  private async enrichWorkflow(
    workflow: StoredWorkflow
  ): Promise<StoredWorkflow> {
    const runs = await this.db.listWorkflowRuns(workflow.id, 1);
    return {
      ...workflow,
      lastRunAt: runs[0]?.startedAt ?? null,
    };
  }
}

function normalizeWorkflowSteps(steps: WorkflowStep[]): WorkflowStep[] {
  return steps.map((step) => ({
    ...step,
    id: step.id.trim(),
  }));
}

function serializeJson(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }

  return JSON.stringify(value);
}

function parseJson(value: string | null): unknown {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function toStepRecord(
  step: StoredWorkflowRunStepRecord
): WorkflowRunStepRecord {
  return {
    completedAt: step.completedAt,
    error: step.error,
    id: step.id,
    input: parseJson(step.input),
    kind: step.kind as WorkflowRunStepRecord["kind"],
    output: parseJson(step.output),
    runId: step.runId,
    startedAt: step.startedAt,
    status: step.status as WorkflowRunStepRecord["status"],
    stepId: step.stepId,
  };
}

function toRunRecord(
  run: StoredWorkflowRunRecord,
  steps?: StoredWorkflowRunStepRecord[]
): WorkflowRunRecord {
  return {
    completedAt: run.completedAt,
    error: run.error,
    id: run.id,
    input: run.input ? (parseJson(run.input) as Record<string, unknown>) : null,
    output: run.output,
    startedAt: run.startedAt,
    status: run.status,
    workflowId: run.workflowId,
    ...(steps ? { steps: steps.map(toStepRecord) } : {}),
  };
}
