import { describe, expect, test } from "bun:test";
import {
  expandLearnInLastUserMessage,
  tryParseLearnCommand,
} from "./learn-prompt";

describe("tryParseLearnCommand", () => {
  test("parses /learn with a source", () => {
    expect(tryParseLearnCommand("/learn filing an expense")).toEqual({
      source: "filing an expense",
    });
    expect(
      tryParseLearnCommand("/learn https://docs.example.com/api\nfocus on auth")
    ).toEqual({
      source: "https://docs.example.com/api\nfocus on auth",
    });
  });

  test("ignores non-learn messages", () => {
    expect(tryParseLearnCommand("learn this")).toBeNull();
    expect(tryParseLearnCommand("/learning")).toBeNull();
    expect(tryParseLearnCommand("/skill learn")).toBeNull();
    expect(tryParseLearnCommand("please /learn later")).toBeNull();
  });
});

describe("expandLearnInLastUserMessage", () => {
  test("expands only the last user message for the provider copy", () => {
    const messages = [
      { content: "hi", role: "user" as const },
      { content: "hello", role: "assistant" as const },
      { content: "/learn expense filing", role: "user" as const },
    ];

    const expanded = expandLearnInLastUserMessage(messages);

    expect(messages[2]?.content).toBe("/learn expense filing");
    expect(expanded[0]?.content).toBe("hi");
    expect(expanded[2]?.content).toContain("[/learn]");
    expect(expanded[2]?.content).toContain("expense filing");
    expect(expanded[2]?.content).not.toBe("/learn expense filing");
  });

  test("leaves non-learn last user messages unchanged", () => {
    const messages = [{ content: "hello", role: "user" as const }];
    expect(expandLearnInLastUserMessage(messages)).toEqual(messages);
  });

  test("bare /learn with an attached document still expands normally", () => {
    const expanded = expandLearnInLastUserMessage([
      {
        content: [
          { text: "/learn", type: "text" as const },
          {
            data: "AAAA",
            filename: "expense-guide.pdf",
            mediaType: "application/pdf",
            type: "document" as const,
          },
        ],
        role: "user" as const,
      },
    ]);

    const textPart = Array.isArray(expanded[0]?.content)
      ? expanded[0].content.find((part) => part.type === "text")
      : null;

    expect(textPart?.type).toBe("text");

    if (textPart?.type === "text") {
      expect(textPart.text).toContain("[/learn]");
      expect(textPart.text).toContain(
        "file(s) or image(s) attached to this message"
      );
      expect(textPart.text).not.toContain("Ask them what to learn from");
    }
  });
});
