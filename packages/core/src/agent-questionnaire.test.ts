import { describe, expect, test } from "bun:test";
import {
  formatAgentQuestionnaireAnswersMessage,
  formatAgentQuestionnaireMessage,
  tryParseChannelQuestionnaireAnswers,
} from "./agent-questionnaire";
import type { AgentQuestionnaire } from "./contract";

const singleQuestion: AgentQuestionnaire = {
  id: "qset_1",
  questions: [
    {
      allowCustomAnswer: true,
      choices: [
        { id: "playwright", label: "Build Playwright e2e" },
        { id: "manual", label: "Manual steps only" },
      ],
      id: "how-to-run",
      prompt: "How should I run this?",
    },
  ],
  title: "Need input",
};

const multiQuestion: AgentQuestionnaire = {
  id: "qset_2",
  questions: [
    {
      allowCustomAnswer: false,
      choices: [
        { id: "red", label: "Red" },
        { id: "blue", label: "Blue" },
      ],
      id: "q1",
      prompt: "Pick a color",
    },
    {
      allowCustomAnswer: true,
      choices: [],
      id: "q2",
      prompt: "Any notes?",
    },
  ],
  title: "Two questions",
};

describe("formatAgentQuestionnaireMessage", () => {
  test("renders title, numbered questions, and reply hint", () => {
    const text = formatAgentQuestionnaireMessage(singleQuestion);

    expect(text).toContain("Need input");
    expect(text).toContain("1. How should I run this?");
    expect(text).toContain("a) Build Playwright e2e");
    expect(text).toContain("b) Manual steps only");
    expect(text).toContain("Or reply with your own answer.");
    expect(text).toContain("Reply with your answer in chat.");
  });
});

describe("tryParseChannelQuestionnaireAnswers", () => {
  test("parses single-question letter, number, label, and free text", () => {
    expect(tryParseChannelQuestionnaireAnswers(singleQuestion, "a")).toEqual([
      {
        answer: "Build Playwright e2e",
        prompt: "How should I run this?",
        questionId: "how-to-run",
      },
    ]);
    expect(
      tryParseChannelQuestionnaireAnswers(singleQuestion, "2")?.[0]?.answer
    ).toBe("Manual steps only");
    expect(
      tryParseChannelQuestionnaireAnswers(
        singleQuestion,
        "Build Playwright e2e"
      )?.[0]?.answer
    ).toBe("Build Playwright e2e");
    expect(
      tryParseChannelQuestionnaireAnswers(
        singleQuestion,
        "ffmpeg pipeline"
      )?.[0]?.answer
    ).toBe("ffmpeg pipeline");
  });

  test("parses multi-question numbered lines into Answers payload shape", () => {
    const answers = tryParseChannelQuestionnaireAnswers(
      multiQuestion,
      ["1. a", "2. keep it short"].join("\n")
    );

    expect(answers).toEqual([
      { answer: "Red", prompt: "Pick a color", questionId: "q1" },
      { answer: "keep it short", prompt: "Any notes?", questionId: "q2" },
    ]);
    expect(formatAgentQuestionnaireAnswersMessage(answers!)).toContain(
      "Answers"
    );
  });
});
