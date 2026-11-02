import { describe, expect, test } from "bun:test";
import { renderTelegramRichText } from "./telegram-rich-text";

describe("renderTelegramRichText", () => {
  test("does not italicize underscores or double-escape query params in links", () => {
    expect(
      renderTelegramRichText("[docs](https://example.com/a_b?x=1&y=2)")
    ).toBe('<a href="https://example.com/a_b?x=1&amp;y=2">docs</a>');
  });

  test("leaves links with parentheses in the url unrendered", () => {
    expect(
      renderTelegramRichText("[docs](https://example.com/path_(draft))")
    ).toBe("[docs](https://example.com/path_(draft))");
  });

  test("preserves snake case identifiers with underscores", () => {
    expect(renderTelegramRichText("Use active_org_id for org context.")).toBe(
      "Use active_org_id for org context."
    );
  });

  test("keeps underscores in bare urls", () => {
    expect(renderTelegramRichText("Open https://x.dev/_a_/b now")).toBe(
      "Open https://x.dev/_a_/b now"
    );
  });

  test("escapes raw html while preserving fenced code blocks", () => {
    expect(
      renderTelegramRichText("Before <tag>\n```js\n  const x = 1 < 2;\n```")
    ).toBe("Before &lt;tag&gt;\n<pre><code>  const x = 1 &lt; 2;</code></pre>");
  });

  test("preserves dollar replacement sequences in fenced code blocks", () => {
    expect(renderTelegramRichText("```text\n$& $` $'\n```")).toBe(
      "<pre><code>$&amp; $` $'</code></pre>"
    );
  });

  test("keeps literal placeholder text beside a code block", () => {
    expect(renderTelegramRichText("@@TCTOKEN0@@\n```text\ncode\n```")).toBe(
      "@@TCTOKEN0@@\n<pre><code>code</code></pre>"
    );
  });

  test("does not format markdown inside inline code", () => {
    expect(renderTelegramRichText("Run `**not bold** a_b_c`")).toBe(
      "Run <code>**not bold** a_b_c</code>"
    );
  });

  test("renders bold, italic, strike and spoiler", () => {
    expect(
      renderTelegramRichText("**b** __b2__ *i* _i2_ ~~gone~~ ||hidden||")
    ).toBe(
      "<b>b</b> <b>b2</b> <i>i</i> <i>i2</i> <s>gone</s> <tg-spoiler>hidden</tg-spoiler>"
    );
  });

  test("does not italicize bullet markers", () => {
    expect(renderTelegramRichText("* one *two*\n* three")).toBe(
      "* one <i>two</i>\n* three"
    );
  });

  test("groups consecutive quote lines into one blockquote", () => {
    expect(
      renderTelegramRichText("Intro\n> line **one**\n> line two\nAfter")
    ).toBe("Intro\n<blockquote>line <b>one</b>\nline two</blockquote>\nAfter");
  });

  test("converts pipe tables into bullet groups", () => {
    expect(
      renderTelegramRichText(
        "Team:\n| Name | Role | Team |\n|---|:---:|---|\n| Ana | Admin | Core |\n| Bo | Dev | |\nDone"
      )
    ).toBe(
      "Team:\n<b>Ana</b>\n• Role: Admin\n• Team: Core\n\n<b>Bo</b>\n• Role: Dev\nDone"
    );
  });

  test("leaves pipe tables inside code fences alone", () => {
    expect(renderTelegramRichText("```\n| a | b |\n|---|---|\n```")).toBe(
      "<pre><code>| a | b |\n|---|---|</code></pre>"
    );
  });
});
