import {
  type ChatMessage,
  formatAutomationRunError,
  type StoredAutomation,
} from "@nakama/core";
import type { AgentService } from "./agent-service";
import type { AutomationDeliveryService } from "./automation-delivery-service";
import type { AutomationService } from "./automation-service";

export class AutomationRunner {
  private readonly running = new Set<string>();

  constructor(
    private readonly automationService: AutomationService,
    private readonly agentService: AgentService,
    private readonly deliveryService?: AutomationDeliveryService
  ) {}

  async run(
    automationId: string
  ): Promise<{ output?: string; error?: string; skipped?: boolean }> {
    if (this.running.has(automationId)) {
      return { error: "Automation is already running.", skipped: true };
    }

    this.running.add(automationId);

    try {
      const automation = await this.automationService.get(automationId);

      if (!automation) {
        throw new Error("Automation not found.");
      }

      if (!automation.enabled) {
        return { error: "Automation is disabled.", skipped: true };
      }

      if (
        !(await this.automationService.isProfileAutomationEnabled(
          automation.profileId
        ))
      ) {
        return {
          error: "Automations are disabled for this profile.",
          skipped: true,
        };
      }

      const orgId = automation.orgId?.trim();
      if (!orgId) {
        throw new Error("Automation organization is missing.");
      }

      if (automation.trigger.type === "runAt") {
        await this.automationService.update(automationId, orgId, {
          enabled: false,
        });
      }

      const run = await this.automationService.createRun(automationId);
      let progress = "";
      const messages: ChatMessage[] = [
        { content: automation.prompt, role: "user" },
      ];
      const publishProgress = () => {
        this.automationService.setRunProgress(run.id, {
          output: progress,
          progress: messages,
        });
      };
      publishProgress();

      try {
        const output = await this.agentService.runAutomationPrompt(
          orgId,
          automation.profileId,
          automation.prompt,
          automationId,
          run.id,
          {
            onChunk: (delta) => {
              // ponytail: cap live text at 100k characters; persist events for full live history.
              progress = (progress + delta).slice(-100_000);
              const last = messages.at(-1);
              if (last?.role === "assistant" && !last.toolCalls) {
                last.content = (last.content + delta).slice(-100_000);
              } else {
                messages.push({ content: delta, role: "assistant" });
              }
              publishProgress();
            },
            onThinking: (delta) => {
              const last = messages.at(-1);
              if (last?.role === "assistant" && !last.toolCalls) {
                last.thinking = ((last.thinking ?? "") + delta).slice(-100_000);
              } else {
                messages.push({
                  content: "",
                  role: "assistant",
                  thinking: delta,
                });
              }
              publishProgress();
            },
            onToolEnd: ({ toolCallId, result }) => {
              const message = messages.find(
                (item) => item.role === "tool" && item.toolCallId === toolCallId
              );
              if (message?.role === "tool") {
                // Large results fall back to a text preview in the chat renderer.
                message.content = (JSON.stringify(result) ?? "").slice(
                  0,
                  100_000
                );
                message.toolCompletedAt = Date.now();
                publishProgress();
              }
            },
            onToolStart: ({ tool, toolCallId, toolGroupId, input }) => {
              messages.push(
                {
                  content: "",
                  role: "assistant",
                  toolCalls: [{ arguments: input, id: toolCallId, name: tool }],
                },
                {
                  content: "",
                  name: tool,
                  role: "tool",
                  toolCallId,
                  toolGroupId,
                  toolStartedAt: Date.now(),
                }
              );
              publishProgress();
            },
          }
        );

        const completedRun = await this.automationService.completeRun(
          run.id,
          automationId,
          { output }
        );
        await this.tryDeliver(automation, completedRun);
        return { output };
      } catch (error) {
        const message = formatAutomationRunError(error);
        const completedRun = await this.automationService.completeRun(
          run.id,
          automationId,
          {
            error: message,
            output: progress || undefined,
          }
        );
        await this.tryDeliver(automation, completedRun);
        return { error: message };
      } finally {
        this.automationService.setRunProgress(run.id);
      }
    } finally {
      this.running.delete(automationId);
    }
  }

  private async tryDeliver(
    automation: StoredAutomation,
    run: Awaited<ReturnType<AutomationService["completeRun"]>>
  ): Promise<void> {
    if (!(this.deliveryService && automation.delivery)) {
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
