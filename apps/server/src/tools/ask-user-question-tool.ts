import {
  type AgentQuestionnaire,
  nanoid,
  type ToolDefinition,
} from "@nakama/core";
import type { AgentQuestionnaireState } from "../services/agent-questionnaire-state";

export function createAskUserQuestionTools(
  questionnaireState: AgentQuestionnaireState
): ToolDefinition[] {
  return [
    {
      description:
        "Ask a short multiple-choice questionnaire when you need missing info before continuing.",
      name: "ask_user_question",
      parameters: {
        additionalProperties: false,
        properties: {
          questions: {
            items: {
              additionalProperties: false,
              properties: {
                allowCustomAnswer: { type: "boolean" },
                choices: { items: { type: "string" }, type: "array" },
                prompt: { type: "string" },
              },
              required: ["prompt", "choices"],
              type: "object",
            },
            type: "array",
          },
          title: { type: "string" },
        },
        required: ["title", "questions"],
        type: "object",
      },
      async run(input, context) {
        const sessionId = context.sessionId;

        if (!sessionId) {
          throw new Error("ask_user_question requires an active chat session.");
        }

        const questionnaire = readQuestionnaire(input);

        if (!questionnaire) {
          throw new Error("title and questions are required.");
        }

        const result = await questionnaireState.write(sessionId, questionnaire);
        return { questionnaire: result };
      },
    },
  ];
}

function slugId(value: string, fallback: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return slug || fallback;
}

function readChoices(
  input: unknown
): Array<{ id?: string; label: string }> | null {
  if (!Array.isArray(input)) {
    return null;
  }

  const choices: Array<{ id?: string; label: string }> = [];

  for (const item of input) {
    if (typeof item === "string") {
      const label = item.trim();
      if (!label) {
        return null;
      }
      choices.push({ label });
      continue;
    }

    // Tolerate legacy { id, label } payloads from older prompts/cassettes.
    if (typeof item === "object" && item !== null) {
      const record = item as Record<string, unknown>;
      const label = typeof record.label === "string" ? record.label.trim() : "";
      const id = typeof record.id === "string" ? record.id.trim() : "";
      if (!label) {
        return null;
      }
      choices.push(id ? { id, label } : { label });
      continue;
    }

    return null;
  }

  return choices;
}

function readQuestionnaire(input: unknown): AgentQuestionnaire | null {
  if (typeof input !== "object" || input === null) {
    return null;
  }

  const record = input as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title.trim() : "";
  const questions = Array.isArray(record.questions) ? record.questions : null;

  if (!(title && questions)) {
    return null;
  }

  const parsed = questions.map((item, questionIndex) => {
    if (typeof item !== "object" || item === null) {
      return null;
    }

    const question = item as Record<string, unknown>;
    const prompt =
      typeof question.prompt === "string" ? question.prompt.trim() : "";
    const rawChoices = readChoices(question.choices);
    const allowCustomAnswer =
      typeof question.allowCustomAnswer === "boolean"
        ? question.allowCustomAnswer
        : false;
    const placeholder =
      typeof question.placeholder === "string" && question.placeholder.trim()
        ? question.placeholder.trim()
        : undefined;
    const explicitId =
      typeof question.id === "string" ? question.id.trim() : "";

    if (!(prompt && rawChoices)) {
      return null;
    }

    const questionId = explicitId || slugId(prompt, `q${questionIndex + 1}`);
    const choices = rawChoices.map((choice, choiceIndex) => ({
      id:
        choice.id || slugId(choice.label, `${questionId}_c${choiceIndex + 1}`),
      label: choice.label,
    }));

    return {
      allowCustomAnswer,
      choices,
      id: questionId,
      placeholder,
      prompt,
    };
  });

  if (parsed.some((question) => question === null)) {
    return null;
  }

  return {
    id: nanoid(),
    questions: parsed as AgentQuestionnaire["questions"],
    title,
  };
}
