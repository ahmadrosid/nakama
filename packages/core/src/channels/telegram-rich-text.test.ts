import { describe, expect, test } from "bun:test";
import {
  escapeTelegramMarkdown,
  renderTelegramRichText,
  splitTelegramRichChunks,
} from "./telegram-rich-text";

describe("renderTelegramRichText", () => {
  test("renders a fence and leaves an unclosed fence as text", () => {
    expect(renderTelegramRichText("```ts\nconst a = 1;\n```")).toBe(
      "<pre><code>const a = 1;</code></pre>"
    );
    expect(renderTelegramRichText(`\`\`\`${"_".repeat(50_000)}`)).toStartWith(
      "```"
    );
  });

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

  test("keeps escaped markdown literal", () => {
    expect(
      renderTelegramRichText(escapeTelegramMarkdown("__weekly__ *digest*"))
    ).toBe("__weekly__ *digest*");
  });

  test("keeps braces in escaped text", () => {
    expect(renderTelegramRichText(escapeTelegramMarkdown("{amount}"))).toBe(
      "{amount}"
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

  test("keeps overlapping markers as nested tags", () => {
    expect(renderTelegramRichText("**a _b** c_")).toBe("<b>a _b</b> c_");
    expect(renderTelegramRichText("***x***")).toBe("<i><b>x</b></i>");
  });

  test("keeps pipes inside inline code and escaped pipes in one cell", () => {
    expect(
      renderTelegramRichText(
        "| Op | Use |\n|---|---|\n| or | `a || b` |\n| pipe | a \\| b |"
      )
    ).toBe(
      "<b>or</b>\n• Use: <code>a || b</code>\n\n<b>pipe</b>\n• Use: a | b"
    );
  });

  test("skips the bold title for an empty first cell", () => {
    expect(renderTelegramRichText("| | Q1 |\n|---|---|\n| | 10 |")).toBe(
      "• Q1: 10"
    );
  });

  test("keeps the header of a table with no rows", () => {
    expect(
      renderTelegramRichText("| Name | Role |\n|---|---|\n(no members yet)")
    ).toBe("Name · Role\n(no members yet)");
  });

  test("stops the table at a line that is not a row", () => {
    expect(
      renderTelegramRichText("| a | b |\n|---|---|\n| 1 | 2 |\nRun `x | y` now")
    ).toBe("<b>1</b>\n• b: 2\nRun <code>x | y</code> now");
  });

  test("formats around bare urls", () => {
    expect(renderTelegramRichText("See **https://x.dev/docs**")).toBe(
      "See <b>https://x.dev/docs</b>"
    );
  });

  test("does not quote lines that only start with >", () => {
    expect(renderTelegramRichText(">= 18 required")).toBe("&gt;= 18 required");
  });

  test("keeps tokens whole when the input holds the placeholder prefix", () => {
    expect(renderTelegramRichText("@@TCTOKEN_ `a` and `b` @@TCTOKEN_X")).toBe(
      "@@TCTOKEN_ <code>a</code> and <code>b</code> @@TCTOKEN_X"
    );
  });
});

describe("splitTelegramRichChunks", () => {
  test("keeps each rendered chunk under the limit", () => {
    const rows = Array.from(
      { length: 200 },
      (_, index) => `| row${index} | a | b | c | d |`
    );

    const table = [
      "| Name | Alpha | Beta | Gamma | Delta |",
      "|---|---|---|---|---|",
      ...rows,
    ].join("\n");

    const chunks = splitTelegramRichChunks(table, 1000);

    expect(chunks.length).toBeGreaterThan(1);

    for (const chunk of chunks) {
      expect(renderTelegramRichText(chunk).length).toBeLessThanOrEqual(1000);
      expect(chunk).not.toContain("|");
    }
  });
});
