/** Render agent Markdown as the HTML subset Telegram accepts (`parse_mode: "HTML"`). */
export function renderTelegramRichText(text: string): string {
  const tokens = createTokenStore(text);
  let result = text.trim();

  result = result.replace(/```[^\n`]*\n?([\s\S]*?)```/g, (_, code: string) =>
    tokens.add(
      `<pre><code>${escapeTelegramHtml(trimFenceNewlines(code))}</code></pre>`
    )
  );
  result = convertTablesToBullets(result);
  result = result.replace(/`([^`\n]+)`/g, (_, code: string) =>
    tokens.add(`<code>${escapeTelegramHtml(code)}</code>`)
  );
  result = result.replace(
    /\[([^\]\n]+)\]\((https?:\/\/[^\s()]+)\)/g,
    (_, label: string, url: string) =>
      tokens.add(
        `<a href="${escapeTelegramAttribute(url)}">${escapeTelegramHtml(label)}</a>`
      )
  );
  result = result.replace(/https?:\/\/[^\s<>\]"'()]+/g, (url) =>
    tokens.add(escapeTelegramHtml(url))
  );

  result = renderBlockquotes(escapeTelegramHtml(result));
  result = renderInlineTelegramFormatting(result);

  return tokens.restore(result).trim();
}

function renderInlineTelegramFormatting(text: string): string {
  let result = text;

  result = result.replace(
    /^#{1,6}\s+(.+)$/gm,
    (_, heading: string) => `<b>${heading.replace(/\*\*/g, "")}</b>`
  );
  result = result.replace(/\*\*(?!\s)([^*\n]+?)\*\*/g, "<b>$1</b>");
  result = result.replace(/__(?!\s)([^_\n]+?)__/g, "<b>$1</b>");
  result = result.replace(/~~(?!\s)([^~\n]+?)~~/g, "<s>$1</s>");
  result = result.replace(
    /\|\|(?!\s)([^|\n]+?)\|\|/g,
    "<tg-spoiler>$1</tg-spoiler>"
  );
  result = result.replace(/\*(?![\s*])([^*\n]+?)(?<!\s)\*/g, "<i>$1</i>");
  // Word-bounded so snake_case identifiers keep their underscores.
  result = result.replace(
    /(?<![\w])_(?![\s_])([^_\n]+?)(?<!\s)_(?![\w])/g,
    "<i>$1</i>"
  );

  return result;
}

/** Group consecutive `> ` lines (already HTML-escaped) into one blockquote. */
function renderBlockquotes(text: string): string {
  return text.replace(/(?:^&gt; ?.*(?:\n|$))+/gm, (block) => {
    const trailingNewline = block.endsWith("\n") ? "\n" : "";

    const body = block
      .replace(/\n$/, "")
      .split("\n")
      .map((line) => line.replace(/^&gt; ?/, ""))
      .join("\n");

    return `<blockquote>${body}</blockquote>${trailingNewline}`;
  });
}

const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

/** Telegram has no table markup: each row becomes a bold title plus `• Header: value` lines. */
function convertTablesToBullets(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const header = lines[index]!;
    const separator = lines[index + 1];

    if (
      !(
        header.includes("|") &&
        separator?.includes("|") &&
        TABLE_SEPARATOR_RE.test(separator)
      )
    ) {
      out.push(header);
      index++;
      continue;
    }

    const headers = splitTableRow(header);
    const groups: string[] = [];
    index += 2;

    while (index < lines.length && lines[index]!.includes("|")) {
      groups.push(renderTableRow(headers, splitTableRow(lines[index]!)));
      index++;
    }

    out.push(groups.join("\n\n"));
  }

  return out.join("\n");
}

function renderTableRow(headers: string[], cells: string[]): string {
  const [title = "", ...rest] = cells;

  if (headers.length <= 1) {
    return `• ${title}`;
  }

  const lines = rest.flatMap((cell, offset) => {
    if (!cell) {
      return [];
    }

    const label = headers[offset + 1];

    return [label ? `• ${label}: ${cell}` : `• ${cell}`];
  });

  return [`**${title}**`, ...lines].join("\n");
}

function splitTableRow(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

/** Holds finished HTML behind placeholders so later passes cannot change it. */
function createTokenStore(source: string) {
  const values: string[] = [];
  let prefix = "@@TCTOKEN";

  while (source.includes(prefix)) {
    prefix += "_";
  }

  return {
    add(html: string): string {
      values.push(html);

      return `${prefix}${values.length - 1}@@`;
    },
    restore(text: string): string {
      const tokenRe = new RegExp(`${prefix}(\\d+)@@`, "g");
      let result = text;

      // A token can hold another token (inline code in a link label).
      for (
        let pass = 0;
        pass <= values.length && result.includes(prefix);
        pass++
      ) {
        result = result.replace(
          tokenRe,
          (_, index: string) => values[Number(index)] ?? ""
        );
      }

      return result;
    },
  };
}

function trimFenceNewlines(text: string): string {
  return text.replace(/^\n/, "").replace(/\n$/, "");
}

function escapeTelegramHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeTelegramAttribute(text: string): string {
  return escapeTelegramHtml(text).replace(/"/g, "&quot;");
}
