import type { AgentQuestionAnswer, AgentQuestionnaire } from "./contract";

const ANSWERS_HEADER = "Answers";

export function hasActiveAgentQuestionnaire(
  questionnaire: AgentQuestionnaire | null | undefined
): boolean {
  return Boolean(questionnaire && questionnaire.questions.length > 0);
}

export function formatAgentQuestionnaireAnswersMessage(
  answers: readonly AgentQuestionAnswer[]
): string {
  const lines = [ANSWERS_HEADER];

  for (const entry of answers) {
    lines.push("", `Q: ${entry.prompt.trim()}`, `A: ${entry.answer.trim()}`);
  }

  return lines.join("\n");
}

export function formatAgentQuestionnaireMessage(
  questionnaire: AgentQuestionnaire
): string {
  const lines = [questionnaire.title.trim(), ""];

  questionnaire.questions.forEach((question, questionIndex) => {
    lines.push(`${questionIndex + 1}. ${question.prompt.trim()}`);

    question.choices.forEach((choice, choiceIndex) => {
      lines.push(
        `   ${choiceLetter(choiceIndex)}) ${choice.label.trim()}${choice.recommended ? " (recommended)" : ""}`
      );
    });

    if (question.allowCustomAnswer) {
      lines.push("   Or reply with your own answer.");
    }

    lines.push("");
  });

  if (questionnaire.questions.length === 1) {
    lines.push("Reply with your answer in chat.");
  } else {
    lines.push("Reply with your answers in chat.");
  }

  return lines.join("\n").trimEnd();
}

export function parseAgentQuestionnaireAnswersMessage(
  value: string
): AgentQuestionAnswer[] | null {
  const trimmed = value.trim();

  if (!trimmed.startsWith(ANSWERS_HEADER)) {
    return null;
  }

  const lines = trimmed.split(/\r?\n/);

  if ((lines[0] ?? "").trim() !== ANSWERS_HEADER) {
    return null;
  }

  const answers: AgentQuestionAnswer[] = [];
  let currentPrompt = "";
  let currentAnswer = "";

  for (const rawLine of lines.slice(1)) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    if (line.startsWith("Q: ")) {
      if (currentPrompt && currentAnswer) {
        answers.push({
          answer: currentAnswer,
          prompt: currentPrompt,
          questionId: `answer_${answers.length + 1}`,
        });
      }

      currentPrompt = line.slice(3).trim();
      currentAnswer = "";
      continue;
    }

    if (line.startsWith("A: ")) {
      currentAnswer = line.slice(3).trim();
      continue;
    }

    return null;
  }

  if (currentPrompt && currentAnswer) {
    answers.push({
      answer: currentAnswer,
      prompt: currentPrompt,
      questionId: `answer_${answers.length + 1}`,
    });
  }

  return answers.length > 0 ? answers : null;
}

/**
 * Questionnaire answers anywhere in a message, also when a channel puts a
 * note (such as a group-chat line) before the "Answers" block.
 */
export function findAgentQuestionnaireAnswers(
  value: string
): AgentQuestionAnswer[] | null {
  const lines = value.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === ANSWERS_HEADER);

  return start === -1
    ? null
    : parseAgentQuestionnaireAnswersMessage(lines.slice(start).join("\n"));
}

function choiceLetter(index: number): string {
  return String.fromCharCode("a".charCodeAt(0) + index);
}
