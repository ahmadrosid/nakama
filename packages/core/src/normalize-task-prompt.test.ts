import { describe, expect, test } from "bun:test";
import { normalizeTaskPrompt } from "./normalize-task-prompt";

describe("normalizeTaskPrompt", () => {
  test("returns plain text unchanged", () => {
    expect(normalizeTaskPrompt("Find the top 5 competitors.")).toBe(
      "Find the top 5 competitors.",
    );
  });

  test("extracts prompt field from JSON object", () => {
    expect(
      normalizeTaskPrompt(
        '{"prompt":"Find the top 5 competitors and summarize their positioning."}',
      ),
    ).toBe("Find the top 5 competitors and summarize their positioning.");
  });

  test("extracts prompt from fenced JSON", () => {
    expect(
      normalizeTaskPrompt('```json\n{"prompt":"Draft a weekly status report."}\n```'),
    ).toBe("Draft a weekly status report.");
  });

  test("extracts prompt from embedded JSON text", () => {
    expect(
      normalizeTaskPrompt(
        'Here is the prompt:\n{"prompt":"Open Gmail and archive obvious promotional emails."}',
      ),
    ).toBe("Open Gmail and archive obvious promotional emails.");
  });

  test("extracts prompt from quoted JSON", () => {
    expect(
      normalizeTaskPrompt('"{\\"prompt\\":\\"Draft a weekly status report.\\"}"'),
    ).toBe("Draft a weekly status report.");
  });
});
