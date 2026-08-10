import { describe, expect, test } from "bun:test";
import type { ProviderClient } from "@nakama/core";
import { normalizeTaskPrompt } from "@nakama/core";
import {
  buildTaskPromptUserPrompt,
  draftTaskPromptFromFields,
} from "./task-prompt";

describe("task prompt drafting", () => {
  test("buildTaskPromptUserPrompt omits empty description", () => {
    expect(buildTaskPromptUserPrompt("Ship docs")).toBe("Title: Ship docs");
    expect(buildTaskPromptUserPrompt("Ship docs", "  ")).toBe(
      "Title: Ship docs"
    );
  });

  test("draftTaskPromptFromFields uses fallback without provider", async () => {
    const prompt = await draftTaskPromptFromFields(
      { description: "Weekly check", title: "Audit logs" },
      {}
    );

    expect(prompt).toContain("Audit logs");
    expect(prompt).toContain("Weekly check");
  });

  test("draftTaskPromptFromFields requires title", async () => {
    await expect(
      draftTaskPromptFromFields({ title: "   " }, {})
    ).rejects.toThrow("Task title is required.");
  });

  test("normalizeTaskPrompt unwraps JSON for provider mocks", () => {
    expect(
      normalizeTaskPrompt('{"prompt":"Summarize competitor positioning."}')
    ).toBe("Summarize competitor positioning.");
  });

  test("draftTaskPromptFromFields unwraps JSON-like provider output", async () => {
    const provider: ProviderClient = {
      async generateChat() {
        throw new Error("unused");
      },
      async generateText() {
        return {
          content:
            'Here is the prompt:\n{"prompt":"Open Gmail and clean up obvious promotional emails."}',
        };
      },
      name: "mock",
      async streamChat() {
        throw new Error("unused");
      },
    };

    await expect(
      draftTaskPromptFromFields({ title: "Email cleanup" }, { provider })
    ).resolves.toBe("Open Gmail and clean up obvious promotional emails.");
  });
});
