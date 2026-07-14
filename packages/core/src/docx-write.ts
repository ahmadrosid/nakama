import type { IParagraphOptions, IRunOptions } from "docx";
import type { Token, Tokens } from "marked";

/**
 * Build a real `.docx` (a ZIP of OOXML parts) from Markdown.
 *
 * `write_file` can only emit UTF-8 text, so an agent asked for a Word document has
 * no honest way to produce one — it ends up saving HTML or bare WordprocessingML
 * under a `.docx` name, which Word then displays as raw stylesheet source. This is
 * the tool that closes that gap.
 */
export async function markdownToDocx(markdown: string): Promise<Buffer> {
  const { Document, Packer, Paragraph, HeadingLevel, TextRun, Table, TableRow, TableCell, WidthType } =
    await import("docx");
  const { marked } = await import("marked");

  const HEADING_BY_DEPTH = [
    HeadingLevel.HEADING_1,
    HeadingLevel.HEADING_2,
    HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4,
    HeadingLevel.HEADING_5,
    HeadingLevel.HEADING_6,
  ];

  /** Flatten inline Markdown (bold, italic, code, links) into styled runs. */
  function toRuns(tokens: Token[] | undefined, inherited: Partial<IRunOptions> = {}): InstanceType<typeof TextRun>[] {
    const runs: InstanceType<typeof TextRun>[] = [];

    for (const token of tokens ?? []) {
      switch (token.type) {
        case "strong":
          runs.push(...toRuns((token as Tokens.Strong).tokens, { ...inherited, bold: true }));
          break;
        case "em":
          runs.push(...toRuns((token as Tokens.Em).tokens, { ...inherited, italics: true }));
          break;
        case "del":
          runs.push(...toRuns((token as Tokens.Del).tokens, { ...inherited, strike: true }));
          break;
        case "link":
          runs.push(...toRuns((token as Tokens.Link).tokens, { ...inherited, style: "Hyperlink" }));
          break;
        case "codespan":
          runs.push(
            new TextRun({
              ...inherited,
              text: (token as Tokens.Codespan).text,
              font: "Courier New",
            }),
          );
          break;
        case "br":
          runs.push(new TextRun({ ...inherited, text: "", break: 1 }));
          break;
        default: {
          const text = "text" in token ? String((token as { text: unknown }).text ?? "") : "";
          if (text) {
            runs.push(new TextRun({ ...inherited, text }));
          }
        }
      }
    }

    return runs;
  }

  function paragraph(tokens: Token[] | undefined, options: IParagraphOptions = {}) {
    const children = toRuns(tokens);
    return new Paragraph({ ...options, children: children.length > 0 ? children : undefined });
  }

  function tableCell(text: string, header: boolean) {
    return new TableCell({
      children: [
        new Paragraph({
          children: [new TextRun({ text, bold: header })],
        }),
      ],
    });
  }

  function blocksFrom(tokens: Token[]): Array<InstanceType<typeof Paragraph> | InstanceType<typeof Table>> {
    const blocks: Array<InstanceType<typeof Paragraph> | InstanceType<typeof Table>> = [];

    for (const token of tokens) {
      switch (token.type) {
        case "heading": {
          const heading = token as Tokens.Heading;
          blocks.push(
            paragraph(heading.tokens, {
              heading: HEADING_BY_DEPTH[Math.min(heading.depth, 6) - 1],
            }),
          );
          break;
        }
        case "paragraph":
          blocks.push(paragraph((token as Tokens.Paragraph).tokens));
          break;
        case "blockquote":
          blocks.push(
            ...blocksFrom((token as Tokens.Blockquote).tokens).map((block) =>
              block instanceof Paragraph ? block : block,
            ),
          );
          break;
        case "list": {
          const list = token as Tokens.List;
          list.items.forEach((item) => {
            blocks.push(
              paragraph(item.tokens, {
                bullet: list.ordered ? undefined : { level: 0 },
                numbering: list.ordered ? { reference: "ordered", level: 0 } : undefined,
              }),
            );
          });
          break;
        }
        case "table": {
          const table = token as Tokens.Table;
          blocks.push(
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [
                new TableRow({
                  children: table.header.map((cell) => tableCell(cell.text, true)),
                }),
                ...table.rows.map(
                  (row) =>
                    new TableRow({
                      children: row.map((cell) => tableCell(cell.text, false)),
                    }),
                ),
              ],
            }),
          );
          break;
        }
        case "code":
          for (const line of (token as Tokens.Code).text.split("\n")) {
            blocks.push(
              new Paragraph({
                children: [new TextRun({ text: line, font: "Courier New" })],
              }),
            );
          }
          break;
        case "hr":
          blocks.push(new Paragraph({ text: "", border: { bottom: { style: "single", size: 6 } } }));
          break;
        default:
          break;
      }
    }

    return blocks;
  }

  const blocks = blocksFrom(marked.lexer(markdown));

  const document = new Document({
    numbering: {
      config: [
        {
          reference: "ordered",
          levels: [{ level: 0, format: "decimal", text: "%1.", alignment: "start" }],
        },
      ],
    },
    sections: [
      {
        children: blocks.length > 0 ? blocks : [new Paragraph({ text: "" })],
      },
    ],
  });

  return Packer.toBuffer(document);
}
