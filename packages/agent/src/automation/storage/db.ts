import type { DatabaseAdapter, StoredAutomationRecord } from "@tinyclaw/db";
import type { AutomationDefinition } from "@tinyclaw/core";
import type { AutomationStore } from "./index";

export class DatabaseAutomationStore implements AutomationStore {
  constructor(private readonly db: DatabaseAdapter) {}

  async list(): Promise<AutomationDefinition[]> {
    const records = await this.db.listAutomations();
    return records.map(fromRecord);
  }

  async get(id: string): Promise<AutomationDefinition | null> {
    const record = await this.db.getAutomation(id);
    return record ? fromRecord(record) : null;
  }

  async save(definition: AutomationDefinition): Promise<void> {
    await this.db.upsertAutomation(toRecord(definition));
  }
}

function fromRecord(record: StoredAutomationRecord): AutomationDefinition {
  const definition = record.definition as Partial<AutomationDefinition> | undefined;

  return {
    id: record.id,
    name: record.name,
    description: definition?.description ?? "",
    prompt: definition?.prompt ?? "",
    trigger: definition?.trigger ?? { type: "manual" },
    steps: definition?.steps ?? [],
    version: definition?.version ?? record.version,
  };
}

function toRecord(definition: AutomationDefinition): StoredAutomationRecord {
  const now = new Date().toISOString();

  return {
    id: definition.id,
    name: definition.name,
    version: definition.version,
    definition,
    createdAt: now,
    updatedAt: now,
  };
}
