import type { AgentQuestionnaire } from "@nakama/core/contract";
import type { DiscordMessenger } from "./messenger";
import { formatAgentQuestionnaireMessage } from "@nakama/core/agent-questionnaire";

export class DiscordQuestionnaireMessage {
  private messageId: string | null = null;
  private lastRendered = "";
  private pending = Promise.resolve();
  private active: AgentQuestionnaire | null = null;

  constructor(private readonly messenger: DiscordMessenger) {}

  getActive(): AgentQuestionnaire | null {
    return this.active;
  }

  async update(questionnaire: AgentQuestionnaire | null): Promise<void> {
    this.active = questionnaire && questionnaire.questions.length > 0 ? questionnaire : null;

    if (!this.active) {
      return;
    }

    await this.enqueueRender(this.active);
  }

  clear(): void {
    this.active = null;
  }

  private async enqueueRender(questionnaire: AgentQuestionnaire): Promise<void> {
    this.pending = this.pending.then(() => this.render(questionnaire));
    await this.pending;
  }

  private async render(questionnaire: AgentQuestionnaire): Promise<void> {
    const next = formatAgentQuestionnaireMessage(questionnaire);

    if (next === this.lastRendered) {
      return;
    }

    try {
      if (this.messageId === null) {
        const message = await this.messenger.send(next);
        this.messageId = message?.id ?? null;
      } else {
        await this.messenger.edit(this.messageId, next);
      }

      this.lastRendered = next;
    } catch {
      // Questionnaire delivery is best-effort only.
    }
  }
}
