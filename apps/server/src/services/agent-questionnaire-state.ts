import type { AgentQuestionnaire } from "@nakama/core";
import type { DatabaseAdapter } from "@nakama/db";

const MAX_QUESTIONS = 5;
const MAX_CHOICES = 5;

export class AgentQuestionnaireState {
  private readonly cache = new Map<string, AgentQuestionnaire | null>();

  constructor(private readonly db: DatabaseAdapter) {}

  async get(sessionId: string): Promise<AgentQuestionnaire | null> {
    if (this.cache.has(sessionId)) {
      return this.cache.get(sessionId) ?? null;
    }

    const questionnaire = await this.db.getSessionQuestionnaire(sessionId);
    this.cache.set(sessionId, questionnaire);
    return questionnaire;
  }

  async write(sessionId: string, questionnaire: AgentQuestionnaire): Promise<AgentQuestionnaire> {
    const normalized = {
      id: questionnaire.id.trim(),
      title: questionnaire.title.trim(),
      questions: questionnaire.questions.map((question) => ({
        id: question.id.trim(),
        prompt: question.prompt.trim(),
        choices: question.choices.map((choice) => ({
          id: choice.id.trim(),
          label: choice.label.trim(),
        })),
        allowCustomAnswer: question.allowCustomAnswer,
        placeholder: question.placeholder?.trim() || undefined,
      })),
    } satisfies AgentQuestionnaire;

    if (!normalized.id) {
      throw new Error("Questionnaire id is required.");
    }

    if (!normalized.title) {
      throw new Error("Questionnaire title is required.");
    }

    if (normalized.questions.length === 0) {
      throw new Error("At least one question is required.");
    }

    if (normalized.questions.length > MAX_QUESTIONS) {
      throw new Error(`A questionnaire can have at most ${MAX_QUESTIONS} questions.`);
    }

    for (const question of normalized.questions) {
      if (!question.id) {
        throw new Error("Each question must have a non-empty id.");
      }

      if (!question.prompt) {
        throw new Error(`Question "${question.id}" must include prompt text.`);
      }

      if (question.choices.length > MAX_CHOICES) {
        throw new Error(
          `Question "${question.id}" can have at most ${MAX_CHOICES} choices.`,
        );
      }

      for (const choice of question.choices) {
        if (!choice.id || !choice.label) {
          throw new Error(`Question "${question.id}" has an invalid choice.`);
        }
      }

      if (!question.allowCustomAnswer && question.choices.length === 0) {
        throw new Error(
          `Question "${question.id}" must allow custom answers or provide at least one choice.`,
        );
      }
    }

    this.cache.set(sessionId, normalized);
    await this.db.updateSessionQuestionnaire(sessionId, normalized);
    return normalized;
  }

  async clear(sessionId: string): Promise<void> {
    this.cache.set(sessionId, null);
    await this.db.updateSessionQuestionnaire(sessionId, null);
  }

  clearSession(sessionId: string): void {
    this.cache.delete(sessionId);
  }
}
