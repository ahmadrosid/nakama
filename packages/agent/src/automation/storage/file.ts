import type { AutomationDefinition } from "@tinyclaw/core";
import type { AutomationStore } from "./index";

export class FileAutomationStore implements AutomationStore {
  constructor(private readonly baseDir: string) {}

  async list(): Promise<AutomationDefinition[]> {
    void this.baseDir;
    return [];
  }

  async get(id: string): Promise<AutomationDefinition | null> {
    void this.baseDir;
    void id;
    return null;
  }

  async save(definition: AutomationDefinition): Promise<void> {
    void this.baseDir;
    void definition;
  }
}
