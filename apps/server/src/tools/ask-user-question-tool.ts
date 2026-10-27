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
        'Ask short multiple-choice questions when info is missing. Every question needs one choice ending in "(Recommended)".',
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

        return {
          message:
            "Questions shown to the user. Wait for the next user message before continuing.",
          questionnaire: result,
        };
      },
    },
  ];
}

// The same "(Recommended)" label convention Claude Code uses, so no schema field.
const RECOMMENDED_SUFFIX = /\s*\(recommended\)$/i;

function slugId(value: string, fallback: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return slug || fallback;
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This tool-input boundary immediately validates untrusted values with QuestionnaireInputSchema.
function readQuestionnaire(input: unknown): AgentQuestionnaire | null {
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

    const rawChoices = question.choices.map((choice) => {
      const label = choice.label.trim();
      const unmarked = label.replace(RECOMMENDED_SUFFIX, "");

      return {
        id: "id" in choice ? choice.id?.trim() : undefined,
        label: unmarked,
        recommended: unmarked !== label,
      };
    });

    if (!prompt || rawChoices.some((choice) => !choice.label)) {
      return null;
    }

    const questionId =
      question.id?.trim() || slugId(prompt, `q${questionIndex + 1}`);

    const recommendedIndex = rawChoices.findIndex(
      (choice) => choice.recommended
    );

    const choices = rawChoices
      .map((choice, choiceIndex) => ({
        id:
          choice.id ||
          slugId(choice.label, `${questionId}_c${choiceIndex + 1}`),
        label: choice.label,
        recommended: choiceIndex === recommendedIndex || undefined,
      }))
      .sort((a, b) => Number(!a.recommended) - Number(!b.recommended));

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
    questions: parsed.filter((question) => question !== null),
    title,
  };
}
