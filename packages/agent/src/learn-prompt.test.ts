import { describe, expect, test } from "bun:test";
import {
  buildLearnPrompt,
  expandLearnInLastUserMessage,
  expandLearnUserContent,
  expandLearnUserMessage,
  tryParseLearnCommand,
} from "./learn-prompt";

describe("tryParseLearnCommand", () => {
  test("parses bare /learn", () => {
    expect(tryParseLearnCommand("/learn")).toEqual({ source: "" });
    expect(tryParseLearnCommand("  /learn  ")).toEqual({ source: "" });
  });

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

describe("buildLearnPrompt", () => {
  test("defaults empty request to the current conversation workflow", () => {
    const prompt = buildLearnPrompt("");
    expect(prompt).toContain("workflow we just went through");
  });
});

describe("expandLearnUserMessage", () => {
  test("expands /learn commands and leaves other text alone", () => {
    expect(expandLearnUserMessage("hello")).toBe("hello");
    expect(expandLearnUserMessage("/learn expense filing")).toContain(
      "[/learn]"
    );
    expect(expandLearnUserMessage("/learn expense filing")).toContain(
      "expense filing"
    );
  });
});

describe("expandLearnUserContent", () => {
  test("expands the first text part in multimodal content", () => {
    const expanded = expandLearnUserContent([
      { text: "/learn expense filing", type: "text" as const },
      {
        imageUrl: "data:image/png;base64,xx",
        mimeType: "image/png",
        type: "image" as const,
      },
    ]);

    expect(expanded[0]).toMatchObject({ type: "text" });
    if (expanded[0] && expanded[0].type === "text") {
      expect(expanded[0].text).toContain("[/learn]");
      expect(expanded[0].text).toContain("expense filing");
    }
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

  test("keeps the learn prompt through a tool-loop turn", () => {
    const expanded = expandLearnInLastUserMessage([
      { content: "/learn filing an expense", role: "user" as const },
      { content: "", role: "assistant" as const },
      { content: "file contents", role: "tool" as const },
    ]);

    expect(expanded[0]?.content).toContain("[/learn]");
    expect(expanded[0]?.content).toContain("filing an expense");
  });

  test("bare /learn as the first message asks for a source", () => {
    const expanded = expandLearnInLastUserMessage([
      { content: "/learn", role: "user" as const },
    ]);

    expect(expanded[0]?.content).toContain("[/learn]");
    expect(expanded[0]?.content).toContain("Ask them what to learn from");
    expect(expanded[0]?.content).not.toContain("workflow we just went through");
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

  test("bare /learn with a document_ref still expands normally", () => {
    const expanded = expandLearnInLastUserMessage([
      {
        content: [
          { text: "/learn", type: "text" as const },
          {
            attachmentId: "att_1",
            filename: "notes.md",
            mediaType: "text/markdown",
            size: 128,
            type: "document_ref" as const,
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
      expect(textPart.text).not.toContain("Ask them what to learn from");
    }
  });

  test("bare /learn after prior turns uses the conversation workflow", () => {
    const expanded = expandLearnInLastUserMessage([
      { content: "how do I deploy staging?", role: "user" as const },
      { content: "Here are the steps…", role: "assistant" as const },
      { content: "/learn", role: "user" as const },
    ]);

    expect(expanded[2]?.content).toContain("[/learn]");
    expect(expanded[2]?.content).toContain("workflow we just went through");
  });
});
