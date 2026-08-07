import { describe, expect, test } from "bun:test";
import type { AgentQuestionnaire } from "./contract";
import {
  formatAgentQuestionnaireAnswersMessage,
  formatAgentQuestionnaireMessage,
  tryParseChannelQuestionnaireAnswers,
} from "./agent-questionnaire";

const singleQuestion: AgentQuestionnaire = {
  id: "qset_1",
  title: "Need input",
  questions: [
    {
      id: "how-to-run",
      prompt: "How should I run this?",
      choices: [
        { id: "playwright", label: "Build Playwright e2e" },
        { id: "manual", label: "Manual steps only" },
      ],
      allowCustomAnswer: true,
    },
  ],
};

const multiQuestion: AgentQuestionnaire = {
  id: "qset_2",
  title: "Two questions",
  questions: [
    {
      id: "q1",
      prompt: "Pick a color",
      choices: [
        { id: "red", label: "Red" },
        { id: "blue", label: "Blue" },
      ],
      allowCustomAnswer: false,
    },
    {
      id: "q2",
      prompt: "Any notes?",
      choices: [],
      allowCustomAnswer: true,
    },
  ],
};

describe("formatAgentQuestionnaireMessage", () => {
  test("renders title, numbered questions, and reply hint", () => {
    const text = formatAgentQuestionnaireMessage(singleQuestion);

    expect(text).toContain("Need input");
    expect(text).toContain("1. How should I run this?");
    expect(text).toContain("a) Build Playwright e2e");
    expect(text).toContain("b) Manual steps only");
    expect(text).toContain("Or reply with your own answer.");
    expect(text).toContain("Reply with a letter/number");
  });
});

describe("tryParseChannelQuestionnaireAnswers", () => {
  test("parses single-question letter, number, label, and free text", () => {
    expect(tryParseChannelQuestionnaireAnswers(singleQuestion, "a")).toEqual([
      {
        questionId: "how-to-run",
        prompt: "How should I run this?",
        answer: "Build Playwright e2e",
      },
    ]);
    expect(tryParseChannelQuestionnaireAnswers(singleQuestion, "2")?.[0]?.answer).toBe(
      "Manual steps only",
    );
    expect(
      tryParseChannelQuestionnaireAnswers(singleQuestion, "Build Playwright e2e")?.[0]?.answer,
    ).toBe("Build Playwright e2e");
    expect(tryParseChannelQuestionnaireAnswers(singleQuestion, "ffmpeg pipeline")?.[0]?.answer).toBe(
      "ffmpeg pipeline",
    );
  });

  test("parses multi-question numbered lines into Answers payload shape", () => {
    const answers = tryParseChannelQuestionnaireAnswers(
      multiQuestion,
      ["1. a", "2. keep it short"].join("\n"),
    );

    expect(answers).toEqual([
      { questionId: "q1", prompt: "Pick a color", answer: "Red" },
      { questionId: "q2", prompt: "Any notes?", answer: "keep it short" },
    ]);
    expect(formatAgentQuestionnaireAnswersMessage(answers!)).toContain("Answers");
  });
});
