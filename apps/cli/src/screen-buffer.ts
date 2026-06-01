export function appendStreamText(
  lines: string[],
  activeLine: string,
  text: string,
  width: number,
): { lines: string[]; activeLine: string } {
  let current = activeLine;
  const nextLines = [...lines];

  for (const char of text) {
    if (char === "\n") {
      nextLines.push(current);
      current = "";
      continue;
    }

    current += char;

    if (current.length >= width) {
      nextLines.push(current);
      current = "";
    }
  }

  return { lines: nextLines, activeLine: current };
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

    this.contentLines.push(this.streamLine);
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
