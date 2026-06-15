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

export interface SgrState {
  bold?: boolean;
  faint?: boolean;
  italic?: boolean;
  underline?: boolean;
  blink?: boolean;
  inverse?: boolean;
  hidden?: boolean;
  strikethrough?: boolean;
  foreground?: string;
  background?: string;
}

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
    (code >= 0x0300 && code <= 0x036f) ||
    (code >= 0x1ab0 && code <= 0x1aff) ||
    (code >= 0x1dc0 && code <= 0x1dff) ||
    (code >= 0x20d0 && code <= 0x20ff) ||
    (code >= 0xfe20 && code <= 0xfe2f) ||
    code === 0x200b ||
    code === 0x200c ||
    code === 0x200d ||
    code === 0xfeff
  ) {
    return 0;
  }

  // Wide ranges: Hangul, CJK, fullwidth forms, emoji blocks, misc symbols.
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xa960 && code <= 0xa97f) ||
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff01 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1f5ff) ||
    (code >= 0x1f600 && code <= 0x1f64f) ||
    (code >= 0x1f680 && code <= 0x1f6ff) ||
    (code >= 0x1f900 && code <= 0x1f9ff) ||
    (code >= 0x1fa70 && code <= 0x1faff) ||
    (code >= 0x2600 && code <= 0x26ff) ||
    (code >= 0x2700 && code <= 0x27bf)
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
  if (ch && /[A-Za-z=><\^#NOc]/.test(ch)) {
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

export function isSgrSequence(seq: string): boolean {
  return /^\x1b\[[0-9;]*m$/.test(seq);
}

export function parseSgrParams(seq: string): number[] {
  const body = seq.slice(2, -1);
  if (body === "") return [0];
  return body.split(";").map((part) => {
    const n = Number(part);
    return Number.isNaN(n) ? 0 : n;
  });
}

export function applySgr(state: SgrState, params: number[]): SgrState {
  const next: SgrState = { ...state };

  for (let i = 0; i < params.length; i += 1) {
    const code = params[i] ?? 0;

    switch (code) {
      case 0:
        return {};
      case 1:
        next.bold = true;
        break;
      case 2:
        next.faint = true;
        break;
      case 3:
        next.italic = true;
        break;
      case 4:
        next.underline = true;
        break;
      case 5:
        next.blink = true;
        break;
      case 7:
        next.inverse = true;
        break;
      case 8:
        next.hidden = true;
        break;
      case 9:
        next.strikethrough = true;
        break;
      case 22:
        delete next.bold;
        delete next.faint;
        break;
      case 23:
        delete next.italic;
        break;
      case 24:
        delete next.underline;
        break;
      case 25:
        delete next.blink;
        break;
      case 27:
        delete next.inverse;
        break;
      case 28:
        delete next.hidden;
        break;
      case 29:
        delete next.strikethrough;
        break;
      case 30:
      case 31:
      case 32:
      case 33:
      case 34:
      case 35:
      case 36:
      case 37:
        next.foreground = String(code);
        break;
      case 38: {
        const mode = params[i + 1];
        if (mode === 5) {
          next.foreground = `38;5;${params[i + 2]}`;
          i += 2;
        } else if (mode === 2) {
          next.foreground = `38;2;${params[i + 2]};${params[i + 3]};${params[i + 4]}`;
          i += 4;
        }
        break;
      }
      case 39:
        delete next.foreground;
        break;
      case 40:
      case 41:
      case 42:
      case 43:
      case 44:
      case 45:
      case 46:
      case 47:
        next.background = String(code);
        break;
      case 48: {
        const mode = params[i + 1];
        if (mode === 5) {
          next.background = `48;5;${params[i + 2]}`;
          i += 2;
        } else if (mode === 2) {
          next.background = `48;2;${params[i + 2]};${params[i + 3]};${params[i + 4]}`;
          i += 4;
        }
        break;
      }
      case 49:
        delete next.background;
        break;
      case 90:
      case 91:
      case 92:
      case 93:
      case 94:
      case 95:
      case 96:
      case 97:
        next.foreground = String(code);
        break;
      case 100:
      case 101:
      case 102:
      case 103:
      case 104:
      case 105:
      case 106:
      case 107:
        next.background = String(code);
        break;
    }
  }

  return next;
}

export function encodeSgr(state: SgrState): string {
  const codes: string[] = [];
  if (state.bold) codes.push("1");
  if (state.faint) codes.push("2");
  if (state.italic) codes.push("3");
  if (state.underline) codes.push("4");
  if (state.blink) codes.push("5");
  if (state.inverse) codes.push("7");
  if (state.hidden) codes.push("8");
  if (state.strikethrough) codes.push("9");
  if (state.foreground) codes.push(state.foreground);
  if (state.background) codes.push(state.background);

  if (codes.length === 0) {
    return "";
  }

  return `\x1b[${codes.join(";")}m`;
}

export function activeAnsiPrefix(text: string): string {
  let state: SgrState = {};

  for (const token of tokenizeText(text)) {
    if (token.type === "ansi" && isSgrSequence(token.value)) {
      state = applySgr(state, parseSgrParams(token.value));
    }
  }

  return encodeSgr(state);
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
 * Slice text by visible columns, preserving ANSI sequences that intersect the
 * requested range. The slice includes any ANSI codes that are active within the
 * range so that color/style remain correct.
 */
export function sliceByColumns(text: string, start: number, end: number): string {
  if (start >= end) {
    return "";
  }

  let result = "";
  let width = 0;

  for (const token of tokenizeText(text)) {
    if (token.type === "ansi") {
      if (width < end && width >= start) {
        result += token.value;
      }
      continue;
    }

    const charWidth = token.width;

    if (width >= end) {
      break;
    }

    if (width + charWidth > start) {
      result += token.value;
    }

    width += charWidth;
  }

  return result;
}

/**
 * Truncate text to fit within `maxWidth` visible columns. Appends an ellipsis
 * when truncation happens.
 */
export function truncateText(
  text: string,
  maxWidth: number,
  ellipsis = "…",
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
