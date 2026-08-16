import { describe, expect, test } from "bun:test";
import {
  buildLearnPrompt,
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
  test("embeds the request and Nakama authoring rules", () => {
    const prompt = buildLearnPrompt(
      "https://docs.example.com/api focus on auth"
    );

    expect(prompt).toContain("[/learn]");
    expect(prompt).toContain("https://docs.example.com/api focus on auth");
    expect(prompt).toContain("skill_manage");
    expect(prompt).toContain("web_fetch");
    expect(prompt).toContain("read_file");
    expect(prompt).toContain("search_files");
    expect(prompt).toContain("## Procedure");
    expect(prompt).toContain("## Pitfalls");
    expect(prompt).toContain("## Verification");
    expect(prompt).toContain("include-body-on-match");
    expect(prompt).toContain("do not invent Hermes-only fields");
    expect(prompt).not.toContain("web_extract");
    expect(prompt).toContain("invented skill_view");
  });

  test("defaults empty request to the current conversation workflow", () => {
    const prompt = buildLearnPrompt("");
    expect(prompt).toContain("workflow we just went through");
  });

  test("requires fold-in instead of duplicate skills", () => {
    const prompt = buildLearnPrompt("expense filing");
    expect(prompt).toContain("near-duplicate");
    expect(prompt).toContain("patch");
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
