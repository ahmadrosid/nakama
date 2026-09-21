import { describe, expect, test } from "bun:test";
import { helpSuggestionsForContext } from "@/components/user-context-presets";

describe("helpSuggestionsForContext", () => {
  test("adapts to an introduction with more than one interest", () => {
    const suggestions = helpSuggestionsForContext(
      "I'm Rosid, a software engineer building my own product."
    );
    expect(suggestions).toContain("Writing code");
    expect(suggestions).toContain("Product decisions");
    expect(suggestions.length).toBeLessThanOrEqual(3);
  });

  test("offers relevant help outside software and a generic fallback", () => {
    expect(helpSuggestionsForContext("I'm a designer")).toContain(
      "Design feedback"
    );
    expect(helpSuggestionsForContext("I'm a student")).toContain(
      "Learning concepts"
    );
    expect(helpSuggestionsForContext("I run a bakery")).toContain(
      "Planning my work"
    );
    expect(helpSuggestionsForContext("")).toEqual([]);
  });
});
