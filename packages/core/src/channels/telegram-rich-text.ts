import { splitTelegramChunks } from "./message-format";

const TELEGRAM_MAX_LENGTH = 4096;

type TokenStore = ReturnType<typeof createTokenStore>;

/** Render agent Markdown as the HTML subset Telegram accepts (`parse_mode: "HTML"`). */
export function renderTelegramRichText(text: string): string {
  const tokens = createTokenStore(text);
  let result = convertMarkdownTables(text.trim());

  result = splitCodeFences(result)
    .map((part, index) => {
      if (index % 2 === 0) {
        return part;
      }

      const code = part.slice(3, -3).replace(/^[^\n`]*\n?/, "");

      return tokens.add(
        `<pre><code>${escapeTelegramHtml(trimFenceNewlines(code))}</code></pre>`
      );
    })
    .join("");
  result = result.replace(/`([^`\n]+)`/g, (_, code: string) =>
    tokens.add(`<code>${escapeTelegramHtml(code)}</code>`)
  );
  // Backslash escapes stay literal, so a name like `__weekly__` keeps its underscores.
  result = result.replace(ESCAPED_MARKDOWN_RE, (_, char: string) =>
    tokens.add(escapeTelegramHtml(char))
  );
  result = result.replace(
    /\[([^\]\n]+)\]\((https?:\/\/[^\s()]+)\)/g,
    (_, label: string, url: string) =>
      tokens.add(
        `<a href="${escapeTelegramAttribute(url)}">${escapeTelegramHtml(label)}</a>`
      )
  );
  result = result.replace(/https?:\/\/[^\s<>\]"'()]+/g, (match) => {
    // Closing markers belong to the formatting around the URL, not the URL.
    const url = match.replace(/[*_~|]+$/, "");

    return tokens.add(escapeTelegramHtml(url)) + match.slice(url.length);
  });

  result = renderBlockquotes(escapeTelegramHtml(result), tokens);
  result = renderInlineTelegramFormatting(result, tokens);

  return tokens.restore(result).trim();
}

/** Plain-text twin of `renderTelegramRichText`, for when Telegram rejects the HTML. */
export function renderTelegramPlainText(text: string): string {
  const html = renderTelegramRichText(text).replace(
    /<a href="([^"]*)">([\s\S]*?)<\/a>/g,
    (_, href: string, label: string) => {
      const plainLabel = stripTags(label);

      return plainLabel === href ? href : `${plainLabel} (${href})`;
    }
  );

  return decodeTelegramHtml(stripTags(html));
}

/** Characters that start Markdown formatting in the Telegram subset. */
const MARKDOWN_SPECIAL_RE = /[\\`*_{}[\]()#+\-.!~|>]/g;

const ESCAPED_MARKDOWN_RE = /\\([\\`*_{}[\]()#+\-.!~|>])/g;

/** Escape literal text so `renderTelegramRichText` keeps it as written. */
export function escapeTelegramMarkdown(text: string): string {
  return text.replace(MARKDOWN_SPECIAL_RE, "\\$&");
}

/**
 * Split Markdown into chunks whose rendered HTML fits Telegram's limit.
 * Tables become bullets first, so a split never cuts a table from its header.
 */
export function splitTelegramRichChunks(
  text: string,
  maxLength = TELEGRAM_MAX_LENGTH
): string[] {
  return splitTelegramChunks(convertMarkdownTables(text), maxLength).flatMap(
    (chunk) => fitRenderedChunk(chunk, maxLength)
  );
}

function fitRenderedChunk(chunk: string, maxLength: number): string[] {
  const renderedLength = renderTelegramRichText(chunk).length;

  if (renderedLength <= maxLength) {
    return [chunk];
  }

  const budget = Math.floor((chunk.length * maxLength) / renderedLength);
  const pieces = splitTelegramChunks(chunk, budget);

  if (
    pieces.length < 2 ||
    pieces.some((piece) => piece.length >= chunk.length)
  ) {
    return [chunk];
  }

  return pieces.flatMap((piece) => fitRenderedChunk(piece, maxLength));
}

const INLINE_RULES: [RegExp, string][] = [
  [/\*\*(?!\s)([^*\n]+?)\*\*/g, "b"],
  [/__(?!\s)([^_\n]+?)__/g, "b"],
  [/~~(?!\s)([^~\n]+?)~~/g, "s"],
  [/\|\|(?!\s)([^|\n]+?)\|\|/g, "tg-spoiler"],
  [/\*(?![\s*])([^*\n]+?)(?<!\s)\*/g, "i"],
  // Word-bounded so snake_case identifiers keep their underscores.
  [/(?<![\w])_(?![\s_])([^_\n]+?)(?<!\s)_(?![\w])/g, "i"],
];

/** Each match becomes a token, so a later rule cannot cut through it and tags always nest. */
function renderInlineTelegramFormatting(
  text: string,
  tokens: TokenStore
): string {
  let result = text.replace(/^#{1,6}[ \t]+(.+)$/gm, (_, heading: string) =>
    tokens.add(
      `<b>${renderInlineTelegramFormatting(heading.replace(/\*\*/g, ""), tokens)}</b>`
    )
  );

  for (const [pattern, tag] of INLINE_RULES) {
    result = result.replace(pattern, (_, inner: string) =>
      tokens.add(
        `<${tag}>${renderInlineTelegramFormatting(inner, tokens)}</${tag}>`
      )
    );
  }

  return result;
}

/** Group consecutive `> ` lines (already HTML-escaped) into one blockquote. */
function renderBlockquotes(text: string, tokens: TokenStore): string {
  return text.replace(/(?:^&gt;(?: .*)?(?:\n|$))+/gm, (block) => {
    const trailingNewline = block.endsWith("\n") ? "\n" : "";

    const body = block
      .replace(/\n$/, "")
      .split("\n")
      .map((line) => line.replace(/^&gt; ?/, ""))
      .join("\n");

    return (
      tokens.add(
        `<blockquote>${renderInlineTelegramFormatting(body, tokens)}</blockquote>`
      ) + trailingNewline
    );
  });
}

/**
 * Split text on closed ``` fences: odd parts are whole fences.
 * A scan instead of a lazy regex, so an unclosed fence stays linear.
 */
function splitCodeFences(text: string): string[] {
  const parts: string[] = [];
  let cursor = 0;

  for (;;) {
    const open = text.indexOf("```", cursor);

    if (open === -1) {
      break;
    }

    let bodyStart = open + 3;

    while (
      bodyStart < text.length &&
      text[bodyStart] !== "\n" &&
      text[bodyStart] !== "`"
    ) {
      bodyStart++;
    }

    const close = text.indexOf("```", bodyStart);

    if (close === -1) {
      break;
    }

    parts.push(text.slice(cursor, open), text.slice(open, close + 3));
    cursor = close + 3;
  }

  parts.push(text.slice(cursor));

  return parts;
}

/** Convert pipe tables outside code fences. Safe to run twice. */
function convertMarkdownTables(text: string): string {
  return splitCodeFences(text)
    .map((part, index) =>
      index % 2 === 1 ? part : convertTablesToBullets(part)
    )
    .join("");
}

/** Telegram has no table markup: each row becomes a bold title plus `• Header: value` lines. */
function convertTablesToBullets(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const header = lines[index]!;
    const separator = lines[index + 1];
    const pipeLed = header.trim().startsWith("|");

    if (
      !(
        isTableRow(header, pipeLed) &&
        separator?.includes("|") &&
        // `|---|:--:|`: each cell is dashes with optional alignment colons.
        separator
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .every((cell) => /^:?-+:?$/.test(cell.trim()))
      )
    ) {
      out.push(header);
      index++;
      continue;
    }

    const headers = splitTableRow(header);
    const groups: string[] = [];
    index += 2;

    while (index < lines.length && isTableRow(lines[index]!, pipeLed)) {
      groups.push(renderTableRow(headers, splitTableRow(lines[index]!)));
      index++;
    }

    const rendered = groups.filter(Boolean);

    out.push(rendered.length > 0 ? rendered.join("\n\n") : headers.join(" · "));
  }

  return out.join("\n");
}

function isTableRow(line: string, pipeLed: boolean): boolean {
  const trimmed = line.trim();

  if (pipeLed) {
    return trimmed.startsWith("|");
  }

  return trimmed !== "" && splitTableRow(trimmed).length > 1;
}

function renderTableRow(headers: string[], cells: string[]): string {
  const [title = "", ...rest] = cells;

  if (headers.length <= 1) {
    return title ? `• ${title}` : "";
  }

  const lines = rest.flatMap((cell, offset) => {
    if (!cell) {
      return [];
    }

    const label = headers[offset + 1];

    return [label ? `• ${label}: ${cell}` : `• ${cell}`];
  });

  if (!title) {
    return lines.join("\n");
  }

  // `**a*b**` cannot render as bold, so keep such titles plain.
  return [title.includes("*") ? title : `**${title}**`, ...lines].join("\n");
}

/** Split on `|` outside inline code; `\|` is a literal pipe. */
function splitTableRow(row: string): string[] {
  const body = row
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "");

  const cells: string[] = [];
  let cell = "";
  let inCode = false;

  for (let index = 0; index < body.length; index++) {
    const char = body[index]!;

    if (char === "\\" && body[index + 1] === "|") {
      cell += "|";
      index++;
      continue;
    }

    if (char === "`") {
      inCode = !inCode;
    }

    if (char === "|" && !inCode) {
      cells.push(cell.trim());
      cell = "";
      continue;
    }

    cell += char;
  }

  cells.push(cell.trim());

  return cells;
}

/** Holds finished HTML behind placeholders so later passes cannot change it. */
function createTokenStore(source: string) {
  const values: string[] = [];
  // Grow with a letter: `_` or `*` would let inline rules match across tokens.
  let prefix = "@@TCTOKEN";

  while (source.includes(prefix)) {
    prefix += "X";
  }

  return {
    add(html: string): string {
      values.push(html);

      return `${prefix}${values.length - 1}@@`;
    },
    restore(text: string): string {
      const tokenRe = new RegExp(`${prefix}(\\d+)@@`, "g");
      let result = text;

      // A token can hold other tokens (formatting around inline code).
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

/** Drop everything from each `<` to its `>`, so no tag can be rebuilt. */
function stripTags(html: string): string {
  let out = "";
  let inTag = false;

  for (const char of html) {
    if (char === "<") {
      inTag = true;
    } else if (char === ">") {
      inTag = false;
    } else if (!inTag) {
      out += char;
    }
  }

  return out;
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

function decodeTelegramHtml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}
