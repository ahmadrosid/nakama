import { describe, expect, test } from "bun:test";
import {
  isPresetRole,
  joinAlways,
  joinReplies,
  splitAlways,
  splitReplies,
  workHintsForRole,
} from "@/components/user-context-presets";

describe("splitReplies", () => {
  test("takes the leading known words and keeps the rest verbatim", () => {
    expect(splitReplies("concise, casual, code first")).toEqual({
      custom: "code first",
      picked: ["concise", "casual"],
    });
  });

  test("keeps free text that does not start with a known word", () => {
    expect(splitReplies("code first, concise")).toEqual({
      custom: "code first, concise",
      picked: [],
    });
  });

  test("round trips through joinReplies", () => {
    const raw = "detailed, formal, cite sources";
    const { picked, custom } = splitReplies(raw);

    expect(joinReplies(picked, custom)).toBe(raw);
  });
});

describe("splitAlways", () => {
  test("separates the reply language from the rest", () => {
    expect(splitAlways("Reply in Bahasa Indonesia. Cite sources.")).toEqual({
      language: "Bahasa Indonesia",
      rest: "Cite sources.",
    });
  });

  test("keeps text without a language sentence verbatim", () => {
    expect(splitAlways("Cite sources.")).toEqual({
      language: "",
      rest: "Cite sources.",
    });
  });

  test("round trips through joinAlways", () => {
    const raw = "Reply in English. Keep code blocks short.";
    const { language, rest } = splitAlways(raw);

    expect(joinAlways(language, rest)).toBe(raw);
  });

  test("drops the language sentence when no language is picked", () => {
    expect(joinAlways("", "Cite sources.")).toBe("Cite sources.");
  });
});

describe("isPresetRole", () => {
  test("recognises a preset label and rejects a typed one", () => {
    expect(isPresetRole("Software engineer")).toBe(true);
    expect(isPresetRole("Chief of staff")).toBe(false);
  });
});

describe("workHintsForRole", () => {
  test("uses the role table when the role is a preset", () => {
    expect(workHintsForRole("Software engineer").stack).toBe(
      "Go, Postgres, Kubernetes"
    );
  });

  test("falls back to the generic hints for a typed role", () => {
    expect(workHintsForRole("Chief of staff").chips).toContain("Notion");
  });
});
