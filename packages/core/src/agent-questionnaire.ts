import type { AgentQuestionAnswer, AgentQuestionnaire } from "./contract";

const ANSWERS_HEADER = "Answers";

export function hasActiveAgentQuestionnaire(
  questionnaire: AgentQuestionnaire | null | undefined,
): boolean {
  return Boolean(questionnaire && questionnaire.questions.length > 0);
}

export function formatAgentQuestionnaireAnswersMessage(
  answers: readonly AgentQuestionAnswer[],
): string {
  const lines = [ANSWERS_HEADER];

  for (const entry of answers) {
    lines.push("", `Q: ${entry.prompt.trim()}`, `A: ${entry.answer.trim()}`);
  }

  return lines.join("\n");
}

export function formatAgentQuestionnaireMessage(questionnaire: AgentQuestionnaire): string {
  const lines = [questionnaire.title.trim(), ""];

  questionnaire.questions.forEach((question, questionIndex) => {
    lines.push(`${questionIndex + 1}. ${question.prompt.trim()}`);

    question.choices.forEach((choice, choiceIndex) => {
      lines.push(`   ${choiceLetter(choiceIndex)}) ${choice.label.trim()}`);
    });

    if (question.allowCustomAnswer) {
      lines.push("   Or reply with your own answer.");
    }

    lines.push("");
  });

  if (questionnaire.questions.length === 1) {
    lines.push("Reply with a letter/number, a choice label, or your answer.");
  } else {
    lines.push("Reply with one line per question, e.g.:");
    lines.push("1. a");
    lines.push("2. your answer");
  }

  return lines.join("\n").trimEnd();
}

export function tryParseChannelQuestionnaireAnswers(
  questionnaire: AgentQuestionnaire,
  text: string,
): AgentQuestionAnswer[] | null {
  const trimmed = text.trim();

  if (!trimmed || questionnaire.questions.length === 0) {
    return null;
  }

  if (questionnaire.questions.length === 1) {
    const question = questionnaire.questions[0]!;
    const answer = resolveQuestionAnswer(question, trimmed);

    if (!answer) {
      return null;
    }

    return [
      {
        questionId: question.id,
        prompt: question.prompt,
        answer,
      },
    ];
  }

  const byIndex = new Map<number, string>();

  for (const rawLine of trimmed.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    const match = line.match(/^(\d+)\s*[.):\-]\s*(.+)$/);

    if (!match) {
      return null;
    }

    const index = Number(match[1]);
    const value = match[2]?.trim() ?? "";

    if (!Number.isInteger(index) || index < 1 || !value) {
      return null;
    }

    byIndex.set(index, value);
  }

  if (byIndex.size !== questionnaire.questions.length) {
    return null;
  }

  const answers: AgentQuestionAnswer[] = [];

  for (let index = 0; index < questionnaire.questions.length; index += 1) {
    const question = questionnaire.questions[index]!;
    const raw = byIndex.get(index + 1);

    if (!raw) {
      return null;
    }

    const answer = resolveQuestionAnswer(question, raw);

    if (!answer) {
      return null;
    }

    answers.push({
      questionId: question.id,
      prompt: question.prompt,
      answer,
    });
  }

  return answers;
}

export function parseAgentQuestionnaireAnswersMessage(
  value: string,
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
          questionId: `answer_${answers.length + 1}`,
          prompt: currentPrompt,
          answer: currentAnswer,
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
      questionId: `answer_${answers.length + 1}`,
      prompt: currentPrompt,
      answer: currentAnswer,
    });
  }

  return answers.length > 0 ? answers : null;
}

function resolveQuestionAnswer(
  question: AgentQuestionnaire["questions"][number],
  raw: string,
): string | null {
  const trimmed = raw.trim();

  if (!trimmed) {
    return null;
  }

  const byNumber = trimmed.match(/^(\d+)$/);
  if (byNumber) {
    const index = Number(byNumber[1]) - 1;
    const choice = question.choices[index];
    if (choice) {
      return choice.label;
    }
  }

  const byLetter = trimmed.match(/^([a-z])$/i);
  if (byLetter) {
    const index = byLetter[1]!.toLowerCase().charCodeAt(0) - "a".charCodeAt(0);
    const choice = question.choices[index];
    if (choice) {
      return choice.label;
    }
  }

  const labelMatch = question.choices.find(
    (choice) => choice.label.trim().toLowerCase() === trimmed.toLowerCase(),
  );
  if (labelMatch) {
    return labelMatch.label;
  }

  if (question.allowCustomAnswer || question.choices.length === 0) {
    return trimmed;
  }

  // Channel chats: accept free text even when choices exist so Discord/Telegram
  // users are not stuck without buttons.
  return trimmed;
}

function choiceLetter(index: number): string {
  return String.fromCharCode("a".charCodeAt(0) + index);
}
