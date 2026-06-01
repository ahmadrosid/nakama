import type { TerminalInput } from "./terminal-input";
import { ScreenBuffer } from "./screen-buffer";

export function computeReservedRows(options: {
  pendingLineCount: number;
  promptLineCount: number;
}): number {
  return Math.max(1, options.pendingLineCount + options.promptLineCount);
}

export function shouldPinToBottom(
  contentBottomRow: number,
  inputRows: number,
  terminalRows: number,
): boolean {
  return contentBottomRow + inputRows >= terminalRows;
}

export function getInputStartLine(contentBottomRow: number): number {
  return contentBottomRow + 1;
}

export function getVisiblePinnedInputRows(inputRows: number, terminalRows: number): number {
  const rows = Math.max(1, inputRows);
  const maxVisibleRows = terminalRows > 1 ? terminalRows - 1 : 1;
  return Math.min(rows, maxVisibleRows);
}

export function getPinnedInputStartLine(inputRows: number, terminalRows: number): number {
  const visibleRows = getVisiblePinnedInputRows(inputRows, terminalRows);
  return Math.max(1, terminalRows - visibleRows + 1);
}

export function getContentBottomLine(state: {
  lastOutputLine: number;
  statusRow: number | null;
  streamRow: number;
}): number {
  return Math.max(state.lastOutputLine, state.statusRow ?? 0, state.streamRow);
}

export function getTerminalRows(): number {
  return process.stdout.rows ?? 24;
}

export function getTerminalColumns(): number {
  return process.stdout.columns ?? 80;
}

export class TerminalLayout {
  private enabled = false;
  private pinned = false;
  private reservedRows = 1;
  private readonly buffer = new ScreenBuffer();
  private contentBottomRow = 0;
  private statusAbsoluteRow: number | null = null;
  private streamAbsoluteRow: number | null = null;
  private streamColumn = 1;
  private streaming = false;
  private anchored = false;
  private previousInputStartRow: number | null = null;
  private previousInputRowCount = 0;
  private resizeHandler: (() => void) | null = null;

  constructor(private readonly terminalInput: TerminalInput | null = null) {}

  apply(): boolean {
    if (!process.stdout.isTTY || !process.stdin.isTTY) {
      return false;
    }

    this.enabled = true;
    this.pinned = false;
    this.anchored = false;
    this.contentBottomRow = 0;

    this.resizeHandler = () => {
      this.syncPinState();
      if (this.pinned) {
        this.updateScrollRegion();
      }

      this.paintInput();
      this.paintStatus();
    };
    process.stdout.on("resize", this.resizeHandler);

    return true;
  }

  async anchorFromCursor(): Promise<void> {
    const row = await this.terminalInput?.requestCursorRow();

    if (row !== null && row > 0) {
      this.contentBottomRow = row - 1;
    }

    this.anchored = true;
  }

  isAnchored(): boolean {
    return this.anchored;
  }

  getLastOutputLine(): number {
    return this.contentBottomRow;
  }

  reset(): void {
    if (this.resizeHandler) {
      process.stdout.off("resize", this.resizeHandler);
      this.resizeHandler = null;
    }

    if (!this.enabled) {
      return;
    }

    this.terminalInput?.setMouseTracking(false);
    process.stdout.write("\x1b[r");
    process.stdout.write("\x1b[?25h");
    this.enabled = false;
    this.pinned = false;
    this.anchored = false;
    this.streaming = false;
    this.statusAbsoluteRow = null;
    this.streamAbsoluteRow = null;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setBottomLines(lines: string[]): void {
    this.buffer.setInputLines(lines);
    this.reservedRows = Math.max(1, lines.length);
    this.syncPinState();
    this.paintInput();
    this.paintStatus();
  }

  setReservedRows(rows: number, lines: string[]): void {
    this.reservedRows = Math.max(1, rows);
    this.buffer.setInputLines(lines);
    this.syncPinState();
    this.paintInput();
    this.paintStatus();
  }

  beginStream(): void {
    this.streaming = false;
    this.buffer.setStatus(null);
    this.statusAbsoluteRow = null;
    this.terminalInput?.setMouseTracking(true);
    this.streamAbsoluteRow = this.pinned ? this.getScrollBottom() : this.getInlineInputStartRow();
    this.streamColumn = 1;
  }

  endStream(): void {
    this.streaming = false;
    this.buffer.setStatus(null);
    this.statusAbsoluteRow = null;
    this.terminalInput?.setMouseTracking(false);
    this.buffer.finalizeStream();

    if (this.streamAbsoluteRow !== null) {
      this.contentBottomRow = Math.max(this.contentBottomRow, this.streamAbsoluteRow);
    }

    this.streamAbsoluteRow = null;
    this.syncPinState();
    this.paintInput();
  }

  writeStatusLine(text: string): void {
    if (!this.enabled) {
      process.stdout.write(`\r\x1b[K${text}`);
      return;
    }

    this.buffer.setStatus(text);

    if (this.pinned) {
      this.statusAbsoluteRow = this.getScrollBottom();
      this.paintInput();
      this.paintStatus();
      return;
    }

    if (this.statusAbsoluteRow === null) {
      const row = this.getInlineInputStartRow();
      process.stdout.write(`\x1b[${row};1H\x1b[K${text}`);
      this.statusAbsoluteRow = row;
      this.streamAbsoluteRow = row;
      this.streamColumn = text.length + 1;
    } else {
      process.stdout.write(`\x1b[${this.statusAbsoluteRow};1H\x1b[K${text}`);
      this.streamAbsoluteRow = this.statusAbsoluteRow;
      this.streamColumn = text.length + 1;
    }

    this.paintInput();
  }

  clearStatusLine(): void {
    let clearedInlineStatus = false;

    if (this.statusAbsoluteRow !== null) {
      if (this.pinned) {
        process.stdout.write(`\x1b[${this.statusAbsoluteRow};1H\x1b[K`);
        this.streaming = false;
      } else {
        const row = this.statusAbsoluteRow;
        process.stdout.write(`\x1b[${row};1H\x1b[K`);
        this.streamAbsoluteRow = row;
        this.streamColumn = 1;
        clearedInlineStatus = true;
      }
    }

    this.buffer.setStatus(null);
    this.statusAbsoluteRow = null;

    if (clearedInlineStatus) {
      this.paintInput();
    }
  }

  writelnBelowStatus(text: string): void {
    if (!this.enabled) {
      process.stdout.write(`${text}\n`);
      return;
    }

    if (this.pinned) {
      const baseRow = this.statusAbsoluteRow ?? this.contentBottomRow;
      const row = baseRow + 1;
      process.stdout.write(`\x1b[${row};1H\x1b[K${text}\n`);
      this.contentBottomRow = row;
      this.buffer.appendLine(text);

      if (this.statusAbsoluteRow !== null && this.buffer.getStatusLine() !== null) {
        this.statusAbsoluteRow = row + 1;
        process.stdout.write(`\x1b[${this.statusAbsoluteRow};1H\x1b[K${this.buffer.getStatusLine()}`);
      }

      this.streaming = false;
      this.syncPinState();
      this.paintInput();
      this.paintStatus();
      return;
    }

    const row = (this.statusAbsoluteRow ?? this.contentBottomRow) + 1;
    process.stdout.write(`\x1b[${row};1H\x1b[K${text}\n`);
    this.contentBottomRow = row;
    this.buffer.appendLine(text);
    this.streamAbsoluteRow = row + 1;
    this.streamColumn = 1;
    this.syncPinState();
    this.paintInput();
    this.paintStatus();
  }

  hasStatusLine(): boolean {
    return this.buffer.getStatusLine() !== null;
  }

  writeScroll(text: string): void {
    if (!this.enabled) {
      process.stdout.write(text);
      return;
    }

    if (this.pinned) {
      if (!this.streaming) {
        this.moveToScrollAppend();
        this.streaming = true;
      }

      this.buffer.appendStream(text, getTerminalColumns());
      process.stdout.write(text);
      return;
    }

    this.writeInlineStream(text);
  }

  writelnScroll(text: string): void {
    if (!this.enabled) {
      process.stdout.write(`${text}\n`);
      return;
    }

    if (!this.anchored) {
      process.stdout.write(`${text}\n`);
      return;
    }

    if (this.pinned) {
      this.writeScroll(`${text}\n`);
      return;
    }

    if (text === "") {
      this.appendContentNewline();
      return;
    }

    this.writeInlineLine(text);
    this.streamAbsoluteRow = this.contentBottomRow + 1;
    this.streamColumn = 1;
    this.syncPinState();
    this.paintInput();
  }

  writelnIntro(text: string): void {
    process.stdout.write(`${text}\n`);
  }

  private writeInlineLine(text: string): void {
    this.syncPinState();

    if (this.pinned) {
      this.writeScroll(`${text}\n`);
      return;
    }

    const row = this.getInlineInputStartRow();
    process.stdout.write(`\x1b[${row};1H\x1b[K${text}\n`);
    this.contentBottomRow = row;
    this.buffer.appendLine(text);
    this.previousInputStartRow = null;
    this.previousInputRowCount = 0;
    this.syncPinState();
  }

  private writeInlineStream(text: string): void {
    this.syncPinState();

    if (this.pinned) {
      if (!this.streaming) {
        this.moveToScrollAppend();
        this.streaming = true;
      }

      process.stdout.write(text);
      this.buffer.appendStream(text, getTerminalColumns());
      return;
    }

    if (this.streamAbsoluteRow === null) {
      this.streamAbsoluteRow = this.getInlineInputStartRow();
      this.streamColumn = 1;
    }

    process.stdout.write(`\x1b[${this.streamAbsoluteRow};${this.streamColumn}H`);
    process.stdout.write(text);
    this.buffer.appendStream(text, getTerminalColumns());

    const width = getTerminalColumns();
    for (const char of text) {
      if (char === "\n") {
        this.streamAbsoluteRow += 1;
        this.streamColumn = 1;
        this.contentBottomRow = Math.max(this.contentBottomRow, this.streamAbsoluteRow);
        continue;
      }

      this.streamColumn += 1;

      if (this.streamColumn > width) {
        this.streamAbsoluteRow += 1;
        this.streamColumn = 1;
        this.contentBottomRow = Math.max(this.contentBottomRow, this.streamAbsoluteRow);
      }
    }

    this.contentBottomRow = Math.max(
      this.contentBottomRow,
      this.streamAbsoluteRow ?? 0,
    );

    this.syncPinState();
  }

  private appendContentNewline(): void {
    const nextRow = (this.streamAbsoluteRow ?? this.contentBottomRow) + 1;
    process.stdout.write(`\x1b[${nextRow};1H\x1b[K`);
    this.contentBottomRow = nextRow;
    this.streamAbsoluteRow = nextRow;
    this.streamColumn = 1;
    this.syncPinState();
  }

  private syncPinState(): void {
    if (!this.anchored) {
      return;
    }

    const inputStart = this.getInlineInputStartRow();
    const nextPinned = shouldPinToBottom(
      inputStart - 1,
      this.buffer.inputRowCount(),
      getTerminalRows(),
    );

    if (nextPinned === this.pinned) {
      return;
    }

    this.pinned = nextPinned;
    this.previousInputStartRow = null;
    this.previousInputRowCount = 0;

    if (this.pinned) {
      this.updateScrollRegion();
      this.streaming = false;
      return;
    }

    process.stdout.write("\x1b[r");
    this.streaming = false;
    this.statusAbsoluteRow = null;
  }

  private getScrollBottom(): number {
    return Math.max(1, getTerminalRows() - this.getVisiblePinnedInputRowCount());
  }

  private getInlineInputStartRow(): number {
    const anchor = this.statusAbsoluteRow ?? this.contentBottomRow;
    return anchor + 1;
  }

  private getVisiblePinnedInputRowCount(): number {
    return getVisiblePinnedInputRows(this.reservedRows, getTerminalRows());
  }

  private paintStatus(): void {
    if (!this.anchored) {
      return;
    }

    const status = this.buffer.getStatusLine();

    if (status === null || this.statusAbsoluteRow === null) {
      return;
    }

    const row = this.pinned ? this.getScrollBottom() : this.statusAbsoluteRow;
    this.statusAbsoluteRow = row;
    process.stdout.write(`\x1b[${row};1H\x1b[K${status}`);
  }

  private paintInput(): void {
    if (!this.enabled || !this.anchored) {
      return;
    }

    if (this.pinned) {
      this.paintPinnedInput();
      return;
    }

    const lines = this.buffer.getInputLines();

    if (this.contentBottomRow === 0) {
      for (let index = 0; index < lines.length; index += 1) {
        if (index === 0) {
          process.stdout.write(`\r\x1b[K${lines[index] ?? ""}`);
        } else {
          process.stdout.write(`\n\x1b[K${lines[index] ?? ""}`);
        }
      }

      process.stdout.write("\x1b[?25l");
      return;
    }

    const startRow = this.getInlineInputStartRow();

    if (this.previousInputStartRow !== null) {
      if (this.previousInputStartRow === startRow) {
        const clearCount = Math.max(lines.length, this.previousInputRowCount);

        for (let index = 0; index < clearCount; index += 1) {
          process.stdout.write(`\x1b[${startRow + index};1H\x1b[K`);
        }
      } else if (this.previousInputStartRow > this.contentBottomRow) {
        for (let index = 0; index < this.previousInputRowCount; index += 1) {
          process.stdout.write(`\x1b[${this.previousInputStartRow + index};1H\x1b[K`);
        }
      }
    }

    for (let index = 0; index < lines.length; index += 1) {
      const row = startRow + index;
      process.stdout.write(`\x1b[${row};1H\x1b[K${lines[index] ?? ""}`);
    }

    this.previousInputStartRow = startRow;
    this.previousInputRowCount = lines.length;

    const inputRow = startRow + lines.length - 1;
    const lastLine = lines[lines.length - 1] ?? "";
    process.stdout.write(`\x1b[${inputRow};${lastLine.length + 1}H`);
    process.stdout.write("\x1b[?25l");
  }

  private paintPinnedInput(): void {
    const rows = getTerminalRows();
    const lines = this.buffer.getInputLines();
    const visibleRows = this.getVisiblePinnedInputRowCount();
    const visibleLines = lines.slice(-visibleRows);
    const startRow = getPinnedInputStartLine(this.reservedRows, rows);
    const contentLimit = this.getPinnedContentBottomLimit(startRow);
    const overflow = this.contentBottomRow - contentLimit;

    this.updateScrollRegion();

    if (overflow > 0) {
      this.scrollContentUp(this.contentBottomRow, overflow);
      this.updateScrollRegion();
    }

    if (this.previousInputStartRow !== null) {
      const previousEndRow = this.previousInputStartRow + this.previousInputRowCount - 1;
      const currentEndRow = startRow + visibleRows - 1;
      const clearFrom = Math.min(this.previousInputStartRow, startRow);
      const clearTo = Math.max(previousEndRow, currentEndRow);

      for (let row = clearFrom; row <= clearTo; row += 1) {
        process.stdout.write(`\x1b[${row};1H\x1b[K`);
      }
    }

    for (let index = 0; index < visibleRows; index += 1) {
      const row = startRow + index;
      process.stdout.write(`\x1b[${row};1H\x1b[K${visibleLines[index] ?? ""}`);
    }

    this.previousInputStartRow = startRow;
    this.previousInputRowCount = visibleRows;

    const inputRow = startRow + visibleLines.length - 1;
    const lastLine = visibleLines[visibleLines.length - 1] ?? "";
    process.stdout.write(`\x1b[${inputRow};${lastLine.length + 1}H`);
    process.stdout.write("\x1b[?25l");
  }

  private getPinnedContentBottomLimit(startRow: number): number {
    const hasPinnedStatus = this.statusAbsoluteRow !== null && this.buffer.getStatusLine() !== null;

    if (hasPinnedStatus) {
      return Math.max(0, startRow - 2);
    }

    return Math.max(0, startRow - 1);
  }

  private scrollContentUp(scrollBottom: number, lines: number): void {
    if (scrollBottom < 1 || lines <= 0) {
      return;
    }

    process.stdout.write(`\x1b[1;${scrollBottom}r`);
    process.stdout.write(`\x1b[${scrollBottom};1H`);

    for (let index = 0; index < lines; index += 1) {
      process.stdout.write("\n");
    }

    this.contentBottomRow = Math.max(0, this.contentBottomRow - lines);

    if (this.pinned && this.streamAbsoluteRow !== null) {
      this.streamAbsoluteRow = this.getScrollBottom();
    }
  }

  private moveToScrollAppend(): void {
    process.stdout.write(`\x1b[${this.getScrollBottom()};1H`);
  }

  private updateScrollRegion(): void {
    const scrollBottom = this.getScrollBottom();
    process.stdout.write(`\x1b[1;${scrollBottom}r`);
    process.stdout.write(`\x1b[${scrollBottom};1H`);
  }
}
