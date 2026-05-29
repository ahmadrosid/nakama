import type { AutomationDefinition, StoredAutomation } from "@tinyclaw/core";
import type { DatabaseAdapter, StoredAutomationRecord } from "./types";

export interface AutomationStore {
  list(): Promise<StoredAutomation[]>;
  get(id: string): Promise<StoredAutomation | null>;
  save(definition: StoredAutomation): Promise<void>;
  delete(id: string): Promise<boolean>;
}

export class DatabaseAutomationStore implements AutomationStore {
  constructor(private readonly db: DatabaseAdapter) {}

  async list(): Promise<StoredAutomation[]> {
    const records = await this.db.listAutomations();
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
  const definition = record.definition as Partial<AutomationDefinition> | undefined;

  return {
    id: record.id,
    name: record.name,
    description: definition?.description ?? "",
    prompt: definition?.prompt ?? "",
    trigger: definition?.trigger ?? { type: "manual" },
    steps: definition?.steps ?? [],
    version: definition?.version ?? record.version,
    profileId: record.profileId,
    enabled: record.enabled,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function toRecord(definition: StoredAutomation): StoredAutomationRecord {
  const now = new Date().toISOString();

  return {
    id: definition.id,
    name: definition.name,
    version: definition.version,
    definition: {
      description: definition.description,
      prompt: definition.prompt,
      trigger: definition.trigger,
      steps: definition.steps,
      version: definition.version,
    },
    profileId: definition.profileId,
    enabled: definition.enabled,
    createdAt: definition.createdAt ?? now,
    updatedAt: now,
  };
}
