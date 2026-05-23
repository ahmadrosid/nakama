import type { AutomationDefinition } from "@tinyclaw/core";

export interface AutomationStore {
  list(): Promise<AutomationDefinition[]>;
  get(id: string): Promise<AutomationDefinition | null>;
  save(definition: AutomationDefinition): Promise<void>;
}
