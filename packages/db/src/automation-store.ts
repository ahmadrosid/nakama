import type { AutomationDefinition, StoredAutomation } from "@nakama/core";
import type { DatabaseAdapter, StoredAutomationRecord } from "./types";

export interface AutomationStore {
  delete(id: string): Promise<boolean>;
  get(id: string): Promise<StoredAutomation | null>;
  list(): Promise<StoredAutomation[]>;
  listForOrg(orgId: string): Promise<StoredAutomation[]>;
  save(definition: StoredAutomation): Promise<void>;
}

export class DatabaseAutomationStore implements AutomationStore {
  constructor(private readonly db: DatabaseAdapter) {}

  async list(): Promise<StoredAutomation[]> {
    const records = await this.db.listAutomations();
    return records.map(fromRecord);
  }

  async listForOrg(orgId: string): Promise<StoredAutomation[]> {
    const records = await this.db.listAutomationsForOrg(orgId);
    return records.map(fromRecord);
  }

  async get(id: string): Promise<StoredAutomation | null> {
    const record = await this.db.getAutomation(id);
    return record ? fromRecord(record) : null;
  }

  async save(definition: StoredAutomation): Promise<void> {
    await this.db.upsertAutomation(toRecord(definition));
  }

  async delete(id: string): Promise<boolean> {
    return this.db.deleteAutomation(id);
  }
}

function fromRecord(record: StoredAutomationRecord): StoredAutomation {
  const definition = record.definition as
    | Partial<AutomationDefinition>
    | undefined;

  return {
    createdAt: record.createdAt,
    delivery: definition?.delivery,
    description: definition?.description ?? "",
    enabled: record.enabled,
    id: record.id,
    name: record.name,
    orgId: record.orgId ?? null,
    profileId: record.profileId,
    prompt: definition?.prompt ?? "",
    steps: definition?.steps ?? [],
    trigger: definition?.trigger ?? { type: "manual" },
    updatedAt: record.updatedAt,
    version: definition?.version ?? record.version,
  };
}

function toRecord(definition: StoredAutomation): StoredAutomationRecord {
  const now = new Date().toISOString();

  return {
    createdAt: definition.createdAt ?? now,
    definition: {
      description: definition.description,
      prompt: definition.prompt,
      steps: definition.steps,
      trigger: definition.trigger,
      version: definition.version,
      ...(definition.delivery ? { delivery: definition.delivery } : {}),
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
