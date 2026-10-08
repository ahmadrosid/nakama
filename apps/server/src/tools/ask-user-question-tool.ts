import {
  type AgentQuestionnaire,
  nanoid,
  type ToolDefinition,
} from "@nakama/core";
import { z } from "zod";
import type { AgentQuestionnaireState } from "../services/agent-questionnaire-state";

const QuestionnaireChoiceSchema = z.union([
  z.string().transform((label) => ({ label })),
  z.object({
    id: z.string().optional().catch(undefined),
    label: z.string(),
  }),
]);

const QuestionnaireInputSchema = z.object({
  questions: z.array(
    z.object({
      allowCustomAnswer: z.boolean().optional().catch(undefined),
      choices: z.array(QuestionnaireChoiceSchema),
      id: z.string().optional().catch(undefined),
      placeholder: z.string().optional().catch(undefined),
      prompt: z.string(),
    })
  ),
  title: z.string(),
});

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

function readQuestionnaire(
  input: z.input<typeof QuestionnaireInputSchema>
): AgentQuestionnaire | null {
  const parsedInput = QuestionnaireInputSchema.safeParse(input);

  if (!parsedInput.success) {
    return null;
  }

  const title = parsedInput.data.title.trim();

  if (!title) {
    return null;
  }

  const parsed = parsedInput.data.questions.map((question, questionIndex) => {
    const prompt = question.prompt.trim();

    const rawChoices = question.choices.map((choice) => ({
      id: "id" in choice ? choice.id?.trim() : undefined,
      label: choice.label.trim(),
    }));

    if (!prompt || rawChoices.some((choice) => !choice.label)) {
      return null;
    }

    const questionId =
      question.id?.trim() || slugId(prompt, `q${questionIndex + 1}`);

    const choices = rawChoices.map((choice, choiceIndex) => ({
      id:
        choice.id || slugId(choice.label, `${questionId}_c${choiceIndex + 1}`),
      label: choice.label,
    }));

    return {
      allowCustomAnswer: question.allowCustomAnswer ?? false,
      choices,
      id: questionId,
      placeholder: question.placeholder?.trim() || undefined,
      prompt,
    };
  });

  if (parsed.some((question) => question === null)) {
    return null;
  }

  return {
    id: nanoid(),
    questions: parsed,
    title,
  };
}
