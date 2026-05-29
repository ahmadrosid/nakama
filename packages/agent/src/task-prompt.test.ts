import { describe, expect, test } from "bun:test";
import type { ProviderClient } from "@tinyclaw/core";
import { normalizeTaskPrompt } from "@tinyclaw/core";
import {
  buildTaskPromptUserPrompt,
  draftTaskPromptFromFields,
  fallbackTaskPrompt,
} from "./task-prompt";

describe("task prompt drafting", () => {
  test("fallback prompt includes title and description", () => {
    expect(fallbackTaskPrompt("Research competitors", "Q2 launch")).toContain(
      "Research competitors",
    );
    expect(fallbackTaskPrompt("Research competitors", "Q2 launch")).toContain("Q2 launch");
  });

  test("buildTaskPromptUserPrompt omits empty description", () => {
    expect(buildTaskPromptUserPrompt("Ship docs")).toBe("Title: Ship docs");
    expect(buildTaskPromptUserPrompt("Ship docs", "  ")).toBe("Title: Ship docs");
  });

  test("draftTaskPromptFromFields uses fallback without provider", async () => {
    const prompt = await draftTaskPromptFromFields(
      { title: "Audit logs", description: "Weekly check" },
      {},
    );

    expect(prompt).toContain("Audit logs");
    expect(prompt).toContain("Weekly check");
  });

  test("draftTaskPromptFromFields requires title", async () => {
    await expect(draftTaskPromptFromFields({ title: "   " }, {})).rejects.toThrow(
      "Task title is required.",
    );
  });

  test("normalizeTaskPrompt unwraps JSON for provider mocks", () => {
    expect(
      normalizeTaskPrompt('{"prompt":"Summarize competitor positioning."}'),
    ).toBe("Summarize competitor positioning.");
  });

  test("draftTaskPromptFromFields unwraps JSON-like provider output", async () => {
    const provider: ProviderClient = {
      name: "mock",
      async generateText() {
        return 'Here is the prompt:\n{"prompt":"Open Gmail and clean up obvious promotional emails."}';
      },
      async generateChat() {
        throw new Error("unused");
      },
      async streamChat() {
        throw new Error("unused");
      },
    };

    await expect(
      draftTaskPromptFromFields({ title: "Email cleanup" }, { provider }),
    ).resolves.toBe("Open Gmail and clean up obvious promotional emails.");
  });
});
