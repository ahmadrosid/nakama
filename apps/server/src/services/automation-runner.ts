import type { StoredAutomation } from "@tinyclaw/core";
import type { AgentService } from "./agent-service";
import type { AutomationService } from "./automation-service";

export class AutomationRunner {
  private readonly running = new Set<string>();

  constructor(
    private readonly automationService: AutomationService,
    private readonly agentService: AgentService,
  ) {}

  async run(automationId: string): Promise<{ output?: string; error?: string; skipped?: boolean }> {
    if (this.running.has(automationId)) {
      return { skipped: true, error: "Automation is already running." };
    }

    const automation = await this.automationService.get(automationId);

    if (!automation) {
      throw new Error("Automation not found.");
    }

    if (!automation.enabled) {
      return { skipped: true, error: "Automation is disabled." };
    }

    this.running.add(automationId);
    const run = await this.automationService.createRun(automationId);

    try {
      const output = await this.agentService.runAutomationPrompt(
        automation.profileId,
        automation.prompt,
      );

      await this.automationService.completeRun(run.id, automationId, { output });
      return { output };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.automationService.completeRun(run.id, automationId, { error: message });
      return { error: message };
    } finally {
      this.running.delete(automationId);
    }
  }

  isRunning(automationId: string): boolean {
    return this.running.has(automationId);
  }

  getActiveRunCount(): number {
    return this.running.size;
  }
}

export function shouldSchedule(automation: StoredAutomation): boolean {
  return automation.enabled && automation.trigger.type === "schedule";
}
