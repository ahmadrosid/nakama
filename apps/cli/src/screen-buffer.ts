import {
  activeAnsiPrefix,
  applySgr,
  encodeSgr,
  isSgrSequence,
  parseSgrParams,
  tokenizeText,
  type SgrState,
  type TextToken,
} from "./text-measure";

export function appendStreamText(
  lines: string[],
  activeLine: string,
  text: string,
  width: number,
): { lines: string[]; activeLine: string } {
  if (width <= 0) {
    return { lines: [...lines, activeLine], activeLine: text };
  }

  const nextLines = [...lines];
  let current = activeLine;
  let currentWidth = visibleWidth(current);
  let sgrState: SgrState = activeSgrState(current);

  function activePrefix(): string {
    return encodeSgr(sgrState);
  }

  function flushCurrentLine(): void {
    if (activePrefix()) {
      nextLines.push(`${current}\x1b[0m`);
    } else {
      nextLines.push(current);
    }
  }

  function consumeToken(token: TextToken): void {
    if (token.type === "ansi") {
      current += token.value;
      if (isSgrSequence(token.value)) {
        sgrState = applySgr(sgrState, parseSgrParams(token.value));
      }
      return;
    }

    if (token.value === "\n") {
      flushCurrentLine();
      current = activePrefix();
      currentWidth = 0;
      return;
    }

    const charWidth = token.width;

    if (charWidth > width && currentWidth === 0) {
      current += token.value;
      currentWidth += charWidth;
    } else if (currentWidth + charWidth > width) {
      flushCurrentLine();
      current = activePrefix() + token.value;
      currentWidth = charWidth;
    } else {
      current += token.value;
      currentWidth += charWidth;
    }
  }

  for (const token of tokenizeText(text)) {
    consumeToken(token);
  }

  if (currentWidth >= width) {
    flushCurrentLine();
    current = activePrefix();
  }

  return { lines: nextLines, activeLine: current };
}

function visibleWidth(text: string): number {
  let width = 0;
  for (const token of tokenizeText(text)) {
    if (token.type === "char") {
      width += token.width;
    }
  }
  return width;
}

function activeSgrState(text: string): SgrState {
  let state: SgrState = {};
  for (const token of tokenizeText(text)) {
    if (token.type === "ansi" && isSgrSequence(token.value)) {
      state = applySgr(state, parseSgrParams(token.value));
    }
  }
  return state;
}

export function finalizeStreamLine(lines: string[], activeLine: string): string[] {
  if (!activeLine) {
    return lines;
  }

  return [...lines, activeLine];
}

export class ScreenBuffer {
  private contentLines: string[] = [];
  private streamLine = "";
  private statusLine: string | null = null;
  private inputLines: string[] = [""];

  appendLine(line: string): void {
    this.finalizeStream();
    this.contentLines.push(line);
  }

  appendStream(text: string, width: number): void {
    const merged = appendStreamText(this.contentLines, this.streamLine, text, width);
    this.contentLines = merged.lines;
    this.streamLine = merged.activeLine;
  }

  finalizeStream(): void {
    if (!this.streamLine) {
      return;
    }

    const activePrefix = activeAnsiPrefix(this.streamLine);
    this.contentLines.push(
      activePrefix ? `${this.streamLine}\x1b[0m` : this.streamLine,
    );
    this.streamLine = "";
  }

  setStatus(line: string | null): void {
    this.statusLine = line;
  }

  setInputLines(lines: string[]): void {
    this.inputLines = lines.length > 0 ? lines : [""];
  }

  getInputLines(): string[] {
    return this.inputLines;
  }

  getStatusLine(): string | null {
    return this.statusLine;
  }

  contentRowCount(): number {
    let count = this.contentLines.length;

    if (this.streamLine) {
      count += 1;
    }

    if (this.statusLine !== null) {
      count += 1;
    }

    return count;
  }

  inputRowCount(): number {
    return this.inputLines.length;
  }

  totalRowCount(): number {
    return this.contentRowCount() + this.inputRowCount();
  }

  getVisibleContentLines(): string[] {
    const lines = [...this.contentLines];

    if (this.streamLine) {
      lines.push(this.streamLine);
    }

    if (this.statusLine !== null) {
      lines.push(this.statusLine);
    }

    return lines;
  }
}
