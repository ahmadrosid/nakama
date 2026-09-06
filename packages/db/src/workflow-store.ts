import type { StoredWorkflow, WorkflowDefinition } from "@nakama/core";
import type { DatabaseAdapter, StoredWorkflowRecord } from "./types";

export class DatabaseWorkflowStore {
  constructor(private readonly db: DatabaseAdapter) {}

  async listForOrg(orgId: string): Promise<StoredWorkflow[]> {
    const records = await this.db.listWorkflowsForOrg(orgId);
    return records.map(fromRecord);
  }

  async get(id: string): Promise<StoredWorkflow | null> {
    const record = await this.db.getWorkflow(id);
    return record ? fromRecord(record) : null;
  }

  async save(definition: StoredWorkflow): Promise<void> {
    await this.db.upsertWorkflow(toRecord(definition));
  }

  async delete(id: string): Promise<boolean> {
    return this.db.deleteWorkflow(id);
  }
}

function fromRecord(record: StoredWorkflowRecord): StoredWorkflow {
  const definition = record.definition as
    | Partial<WorkflowDefinition>
    | undefined;

  return {
    createdAt: record.createdAt,
    description: definition?.description ?? "",
    enabled: record.enabled,
    id: record.id,
    name: record.name,
    orgId: record.orgId ?? null,
    profileId: record.profileId,
    steps: definition?.steps ?? [],
    updatedAt: record.updatedAt,
    version: definition?.version ?? record.version,
  };
}

function toRecord(definition: StoredWorkflow): StoredWorkflowRecord {
  const now = new Date().toISOString();

  return {
    createdAt: definition.createdAt ?? now,
    definition: {
      description: definition.description,
      steps: definition.steps,
      version: definition.version,
    },
    enabled: definition.enabled,
    id: definition.id,
    name: definition.name,
    orgId: definition.orgId ?? null,
    profileId: definition.profileId,
    updatedAt: now,
    version: definition.version,
  };
}
