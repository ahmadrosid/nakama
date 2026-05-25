import type { StoredAutomation } from "@tinyclaw/core";

export interface AutomationStore {
  list(): Promise<StoredAutomation[]>;
  get(id: string): Promise<StoredAutomation | null>;
  save(definition: StoredAutomation): Promise<void>;
  delete(id: string): Promise<boolean>;
}
