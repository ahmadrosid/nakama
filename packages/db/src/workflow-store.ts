import type { StoredWorkflow, WorkflowDefinition } from "@nakama/core";
import type { DatabaseAdapter, StoredWorkflowRecord } from "./types";

export class DatabaseWorkflowStore {
  constructor(private readonly db: DatabaseAdapter) {}

  async listForOrg(orgId: string): Promise<StoredWorkflow[]> {
    const records = await this.db.listWorkflowsForOrg(orgId);

    return records.map(fromRecord);
  }
}

function fromRecord(record: StoredWorkflowRecord): StoredWorkflow {
  // SAFETY: DatabaseAdapter stores this definition from a typed workflow input.
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
