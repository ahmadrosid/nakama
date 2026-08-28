import { describe, expect, test } from "bun:test";
import { NakamaApiError } from "@nakama/core/api-error";
import { reportSkillSaveError } from "./skill-detail-page.shared";

describe("reportSkillSaveError", () => {
  test("toasts and returns the formatted API error", () => {
    const messages: string[] = [];

    const message = reportSkillSaveError(
      new NakamaApiError("Skill body is required.", 400),
      (next) => {
        messages.push(next);
      }
    );

    expect(message).toBe("Skill body is required.");
    expect(messages).toEqual(["Skill body is required."]);
  });

  test("toasts and returns network-unreachable copy", () => {
    const messages: string[] = [];

    const message = reportSkillSaveError(
      new TypeError("Failed to fetch"),
      (next) => {
        messages.push(next);
      }
    );

    expect(message).toBe(
      "Could not reach the Nakama server. Make sure it is running."
    );
    expect(messages).toEqual([message]);
  });
});
