import { describe, expect, test } from "bun:test";
import { unzipSync } from "fflate";
import { markdownToDocx } from "./docx-write";

/** Every run in document order, as `[text, bold, italic]`. */
function runsOf(xml: string): Array<[string, boolean, boolean]> {
  return [...xml.matchAll(/<w:r>(.*?)<\/w:r>/gs)].map((match) => {
    const run = match[1] ?? "";
    const text = [...run.matchAll(/<w:t[^>]*>(.*?)<\/w:t>/gs)]
      .map((t) => t[1] ?? "")
      .join("");
    return [
      text,
      /<w:b\s*\/>|<w:b [^>]*\/>/.test(run),
      /<w:i\s*\/>|<w:i [^>]*\/>/.test(run),
    ];
  });
}

async function documentXml(markdown: string): Promise<string> {
  const bytes = await markdownToDocx(markdown);
  const entry = unzipSync(new Uint8Array(bytes))["word/document.xml"];
  if (!entry) {
    throw new Error("word/document.xml missing from the generated file");
  }
  return new TextDecoder().decode(entry);
}

describe("markdownToDocx table cells", () => {
  test("parses inline markdown inside a cell", async () => {
    const xml = await documentXml(
      "| Risk | Level |\n| --- | --- |\n| **Falling** from height | _high_ |\n"
    );
    const runs = runsOf(xml);

    // The bug shipped one run holding the literal source. The fix splits it.
    expect(runs.map((run) => run[0])).not.toContain("**Falling** from height");
    expect(runs).toContainEqual(["Falling", true, false]);
    expect(runs).toContainEqual([" from height", false, false]);
    expect(runs).toContainEqual(["high", false, true]);
  });

  test("a header cell stays bold through its emphasis", async () => {
    const xml = await documentXml(
      "| **Risk** level | Plain |\n| --- | --- |\n| a | b |\n"
    );
    const runs = runsOf(xml);

    // Bold arrives as inherited state, so nested emphasis must not drop it.
    expect(runs).toContainEqual(["Risk", true, false]);
    expect(runs).toContainEqual([" level", true, false]);
    expect(runs).toContainEqual(["Plain", true, false]);
  });

  test("an empty cell still produces a cell", async () => {
    const xml = await documentXml("| A | B |\n| --- | --- |\n| x |  |\n");

    // toRuns returns nothing for an empty cell; the fallback keeps the table
    // shape rather than emitting a paragraph with no children.
    expect(xml).toContain("<w:tbl>");
    expect(runsOf(xml).map((run) => run[0])).toContain("x");
  });

  test("paragraphs outside a table are unchanged", async () => {
    const runs = runsOf(
      await documentXml("Outside a table **bold** and _italic_ work.\n")
    );

    expect(runs).toContainEqual(["bold", true, false]);
    expect(runs).toContainEqual(["italic", false, true]);
  });
});
