/**
 * ANSI-aware text measurement and wrapping for terminal rendering.
 *
 * Terminal rendering needs to reason about *visible* columns, not raw string
 * length. Escape sequences consume zero columns, and many Unicode characters
 * (CJK, emoji, fullwidth forms) consume two. The helpers here keep wrapping and
 * cursor math correct for those cases.
 */

export type TextToken =
  | { type: "ansi"; value: string }
  | { type: "char"; value: string; width: number };

/**
 * Returns the visible column width of a single character.
 * Zero-width joiners/combining marks return 0, common CJK and emoji ranges
 * return 2, everything else returns 1. This is intentionally simple; it covers
 * the common cases without importing a full wcwidth table.
 */
export function getCharWidth(char: string): number {
  const code = char.codePointAt(0) ?? 0;

  // Zero-width / combining marks
  if (
    (code >= 0x03_00 && code <= 0x03_6f) ||
    (code >= 0x1a_b0 && code <= 0x1a_ff) ||
    (code >= 0x1d_c0 && code <= 0x1d_ff) ||
    (code >= 0x20_d0 && code <= 0x20_ff) ||
    (code >= 0xfe_20 && code <= 0xfe_2f) ||
    code === 0x20_0b ||
    code === 0x20_0c ||
    code === 0x20_0d ||
    code === 0xfe_ff
  ) {
    return 0;
  }

  // Wide ranges: Hangul, CJK, fullwidth forms, emoji blocks, misc symbols.
  if (
    (code >= 0x11_00 && code <= 0x11_5f) ||
    (code >= 0x2e_80 && code <= 0xa4_cf) ||
    (code >= 0xa9_60 && code <= 0xa9_7f) ||
    (code >= 0xac_00 && code <= 0xd7_af) ||
    (code >= 0xf9_00 && code <= 0xfa_ff) ||
    (code >= 0xfe_10 && code <= 0xfe_19) ||
    (code >= 0xfe_30 && code <= 0xfe_6f) ||
    (code >= 0xff_01 && code <= 0xff_60) ||
    (code >= 0xff_e0 && code <= 0xff_e6) ||
    (code >= 0x1_f3_00 && code <= 0x1_f5_ff) ||
    (code >= 0x1_f6_00 && code <= 0x1_f6_4f) ||
    (code >= 0x1_f6_80 && code <= 0x1_f6_ff) ||
    (code >= 0x1_f9_00 && code <= 0x1_f9_ff) ||
    (code >= 0x1_fa_70 && code <= 0x1_fa_ff) ||
    (code >= 0x26_00 && code <= 0x26_ff) ||
    (code >= 0x27_00 && code <= 0x27_bf)
  ) {
    return 2;
  }

  return 1;
}

function readAnsiSequence(text: string, start: number): string {
  if (text[start] !== "\x1b") {
    return text[start] ?? "";
  }

  let i = start + 1;
  if (i >= text.length) {
    return text.slice(start);
  }

  const ch = text[i];

  // CSI: ESC [ params final
  if (ch === "[") {
    i += 1;
    while (i < text.length && /[0-9;]/.test(text[i] as string)) {
      i += 1;
    }
    if (i < text.length) {
      i += 1;
    }
    return text.slice(start, i);
  }

  // OSC: ESC ] string BEL or ESC \
  if (ch === "]") {
    i += 1;
    while (i < text.length) {
      if (text[i] === "\x07") {
        i += 1;
        break;
      }
      if (text[i] === "\x1b" && text[i + 1] === "\\") {
        i += 2;
        break;
      }
      i += 1;
    }
    return text.slice(start, i);
  }

  // Single-letter escape sequences (cursor movement, etc.).
  if (ch && /[A-Za-z=><^#NOc]/.test(ch)) {
    return text.slice(start, i + 1);
  }

  // Unknown sequence: keep just ESC so callers do not drop data.
  return text.slice(start, i);
}

/**
 * Tokenize text into ANSI sequences and visible characters. Each character
 * includes its terminal column width.
 */
export function* tokenizeText(text: string): Generator<TextToken> {
  let i = 0;
  while (i < text.length) {
    if (text[i] === "\x1b") {
      const value = readAnsiSequence(text, i);
      yield { type: "ansi", value };
      i += value.length;
      continue;
    }

    const char = text[i] as string;
    yield { type: "char", value: char, width: getCharWidth(char) };
    i += 1;
  }
}

/**
 * Remove ANSI escape sequences from text.
 */
export function stripAnsi(text: string): string {
  let result = "";
  for (const token of tokenizeText(text)) {
    if (token.type === "char") {
      result += token.value;
    }
  }
  return result;
}

/**
 * Visible column width of the text.
 */
export function visibleLength(text: string): number {
  let length = 0;
  for (const token of tokenizeText(text)) {
    if (token.type === "char") {
      length += token.width;
    }
  }
  return length;
}

function isSgrSequence(seq: string): boolean {
  return /^\x1b\[[0-9;]*m$/.test(seq);
}

function parseSgrParams(seq: string): number[] {
  const body = seq.slice(2, -1);
  if (body === "") {
    return [0];
  }
  return body.split(";").map((part) => {
    const n = Number(part);
    return Number.isNaN(n) ? 0 : n;
  });
}

/** Last open SGR sequence stack as a re-emit prefix (reset clears). */
function activeAnsiPrefix(text: string): string {
  const opens: string[] = [];

  for (const token of tokenizeText(text)) {
    if (token.type !== "ansi" || !isSgrSequence(token.value)) {
      continue;
    }

    const params = parseSgrParams(token.value);
    if (params.length === 1 && params[0] === 0) {
      opens.length = 0;
      continue;
    }

    opens.push(token.value);
  }

  return opens.join("");
}

/**
 * Wrap text into lines of at most `width` visible columns. ANSI SGR sequences
 * are preserved across line breaks so that color/style continue on the next
 * line. Explicit newlines create new lines.
 */
export function wrapText(text: string, width: number): string[] {
  if (width <= 0) {
    return text.length === 0 ? [""] : [text];
  }

  const lines: string[] = [];
  let currentLine = "";
  let currentWidth = 0;
  let activePrefix = "";

  function flushCurrentLine(): void {
    if (activePrefix) {
      lines.push(`${currentLine}\x1b[0m`);
    } else {
      lines.push(currentLine);
    }
  }

  for (const token of tokenizeText(text)) {
    if (token.type === "ansi") {
      currentLine += token.value;
      if (isSgrSequence(token.value)) {
        activePrefix = activeAnsiPrefix(currentLine);
      }
      continue;
    }

    if (token.value === "\n") {
      flushCurrentLine();
      currentLine = activePrefix;
      currentWidth = 0;
      continue;
    }

    const charWidth = token.width;

    if (charWidth > width && currentWidth === 0) {
      // Character is wider than the whole line; place it alone.
      currentLine += token.value;
      currentWidth += charWidth;
    } else if (currentWidth + charWidth > width) {
      flushCurrentLine();
      currentLine = activePrefix + token.value;
      currentWidth = charWidth;
    } else {
      currentLine += token.value;
      currentWidth += charWidth;
    }
  }

  if (currentLine || lines.length === 0) {
    lines.push(currentLine);
  }

  return lines;
}

/**
 * Truncate text to fit within `maxWidth` visible columns. Appends an ellipsis
 * when truncation happens.
 */
export function truncateText(
  text: string,
  maxWidth: number,
  ellipsis = "…"
): string {
  if (maxWidth <= 0) {
    return "";
  }

  const ellipsisWidth = visibleLength(ellipsis);
  let result = "";
  let width = 0;
  let activePrefix = "";

  for (const token of tokenizeText(text)) {
    if (token.type === "ansi") {
      result += token.value;
      if (isSgrSequence(token.value)) {
        activePrefix = activeAnsiPrefix(result);
      }
      continue;
    }

    if (width + token.width + ellipsisWidth > maxWidth) {
      result += ellipsis;
      if (activePrefix) {
        result += "\x1b[0m";
      }
      break;
    }

    result += token.value;
    width += token.width;
  }

  return result;
}
