import { nanoid, type AgentQuestionnaire, type ToolDefinition } from "@nakama/core";
import type { AgentQuestionnaireState } from "../services/agent-questionnaire-state";

export function createAskUserQuestionTools(
  questionnaireState: AgentQuestionnaireState,
): ToolDefinition[] {
  return [
    {
      name: "ask_user_question",
      description:
        "Ask the user a short step-by-step questionnaire when you need missing information before continuing. Prefer 2-4 predefined choices for each question, and when useful also allow the user to type their own custom answer. Keep the questionnaire concise and wait for the user's answers before continuing.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Short heading shown above the questionnaire.",
          },
          questions: {
            type: "array",
            description: "Questions to show to the user.",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "Stable question identifier." },
                prompt: { type: "string", description: "Question text shown to the user." },
                allowCustomAnswer: {
                  type: "boolean",
                  description:
                    "Whether the user may provide their own custom answer in addition to the listed choices.",
                },
                placeholder: {
                  type: "string",
                  description: "Optional placeholder for the custom answer input.",
                },
                choices: {
                  type: "array",
                  description:
                    "Optional single-select choices shown to the user. Prefer concrete options first, and also allow custom input when the user may want to provide their own answer.",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string", description: "Stable choice identifier." },
                      label: { type: "string", description: "Choice text shown to the user." },
                    },
                    required: ["id", "label"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["id", "prompt", "allowCustomAnswer", "choices"],
              additionalProperties: false,
            },
          },
        },
        required: ["title", "questions"],
        additionalProperties: false,
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

function readQuestionnaire(input: unknown): AgentQuestionnaire | null {
  if (typeof input !== "object" || input === null) {
    return null;
  }

  const record = input as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title.trim() : "";
  const questions = Array.isArray(record.questions) ? record.questions : null;

  if (!title || !questions) {
    return null;
  }

  const parsed = questions.map((item) => {
    if (typeof item !== "object" || item === null) {
      return null;
    }

    const question = item as Record<string, unknown>;
    const id = typeof question.id === "string" ? question.id.trim() : "";
    const prompt = typeof question.prompt === "string" ? question.prompt.trim() : "";
    const allowCustomAnswer =
      typeof question.allowCustomAnswer === "boolean" ? question.allowCustomAnswer : null;
    const placeholder =
      typeof question.placeholder === "string" && question.placeholder.trim()
        ? question.placeholder.trim()
        : undefined;
    const choicesInput = Array.isArray(question.choices) ? question.choices : null;

    if (!id || !prompt || allowCustomAnswer === null || !choicesInput) {
      return null;
    }

    const choices = choicesInput.map((choice) => {
      if (typeof choice !== "object" || choice === null) {
        return null;
      }

      const value = choice as Record<string, unknown>;
      const choiceId = typeof value.id === "string" ? value.id.trim() : "";
      const label = typeof value.label === "string" ? value.label.trim() : "";

      if (!choiceId || !label) {
        return null;
      }

      return { id: choiceId, label };
    });

    if (choices.some((choice) => choice === null)) {
      return null;
    }

    return {
      id,
      prompt,
      choices: choices as Array<{ id: string; label: string }>,
      allowCustomAnswer,
      placeholder,
    };
  });

  if (parsed.some((question) => question === null)) {
    return null;
  }

  return {
    id: nanoid(),
    title,
    questions: parsed as AgentQuestionnaire["questions"],
  };
}
