import { isWorkerSchedulable, type StoredAutomation } from "@tinyclaw/core";
import type { AgentService } from "./agent-service";
import type { AutomationDeliveryService } from "./automation-delivery-service";
import type { AutomationService } from "./automation-service";

export class AutomationRunner {
  private readonly running = new Set<string>();

  constructor(
    private readonly automationService: AutomationService,
    private readonly agentService: AgentService,
    private readonly deliveryService?: AutomationDeliveryService,
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

    const orgId = automation.orgId?.trim();
    if (!orgId) {
      throw new Error("Automation organization is missing.");
    }

    if (automation.trigger.type === "runAt") {
      await this.automationService.update(automationId, orgId, { enabled: false });
    }

    this.running.add(automationId);
    const run = await this.automationService.createRun(automationId);

    try {
      const output = await this.agentService.runAutomationPrompt(
        orgId,
        automation.profileId,
        automation.prompt,
      );

      const completedRun = await this.automationService.completeRun(run.id, automationId, { output });
      await this.tryDeliver(automation, completedRun);
      return { output };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const completedRun = await this.automationService.completeRun(run.id, automationId, {
        error: message,
      });
      await this.tryDeliver(automation, completedRun);
      return { error: message };
    } finally {
      this.running.delete(automationId);
    }
  }

  private async tryDeliver(
    automation: StoredAutomation,
    run: Awaited<ReturnType<AutomationService["completeRun"]>>,
  ): Promise<void> {
    if (!this.deliveryService || !automation.delivery) {
      return;
    }

    try {
      await this.deliveryService.deliver(automation, run);
    } catch (error) {
      console.error("Automation delivery failed:", error);
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
  return isWorkerSchedulable(automation);
}
