import { describe, expect, test } from "bun:test";
import { findAgentQuestionnaireAnswers } from "./agent-questionnaire";

describe("findAgentQuestionnaireAnswers", () => {
  test("reads answers after a channel note", () => {
    expect(
      findAgentQuestionnaireAnswers(
        "[Telegram group note]\nAnswers\n\nQ: Mau ke mana?\nA: Bali"
      )
    ).toEqual([
      { answer: "Bali", prompt: "Mau ke mana?", questionId: "answer_1" },
    ]);
  });

  test("returns null for a plain message", () => {
    expect(findAgentQuestionnaireAnswers("Answers are welcome")).toBeNull();
  });
});
