import type { TerminalInput } from "./terminal-input";
import {
  clampFrameCursor,
  cursorColFromLine,
  diffFrames,
  serializeDiffOps,
  type FrameModel,
} from "./terminal-frame";
import {
  normalizeStyledLine,
  plainLine,
  styledLine,
  styledLineText,
  type StyledLine,
} from "./styled-text";
import { wrapText } from "./text-measure";
import type { MessageKind } from "./virtual-message-list";
import { VirtualMessageList } from "./virtual-message-list";

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

const TRANSCRIPT_HORIZONTAL_PADDING = 1;

function wrapPlainTextToLines(text: string, width: number): string[] {
  const normalized = text.replace(/\r\n?/g, "\n");
  const logicalLines = normalized.split("\n");
  const wrappedLines: string[] = [];

  for (const logicalLine of logicalLines) {
    if (logicalLine === "") {
      wrappedLines.push("");
      continue;
    }

    wrappedLines.push(...wrapText(logicalLine, Math.max(1, width)));
  }

  return wrappedLines.length > 0 ? wrappedLines : [""];
}

function padTranscriptLine(text: string): string {
  return `${" ".repeat(TRANSCRIPT_HORIZONTAL_PADDING)}${text}${" ".repeat(TRANSCRIPT_HORIZONTAL_PADDING)}`;
}

function wrapPaddedTranscriptLines(text: string, width: number): string[] {
  const contentWidth = Math.max(1, width - TRANSCRIPT_HORIZONTAL_PADDING * 2);
  return wrapPlainTextToLines(text, contentWidth).map((line) => padTranscriptLine(line));
}

export class TerminalLayout {
  private enabled = false;
  private reservedRows = 1;
  private anchored = false;
  private anchorRow = 1;
  private viewportTopRow = 1;
  private messages = new VirtualMessageList();
  private streamBuffer = "";
  private statusLine: StyledLine | null = null;
  private inputLines: StyledLine[] = [plainLine("")];
  private previousFrame: FrameModel | null = null;
  private historyOffset = 0;
  private followOutput = true;
  private debugOverlay = false;
  private contentWindowRows = 1;
  private resizeHandler: (() => void) | null = null;

  constructor(private readonly terminalInput: TerminalInput | null = null) {}

  apply(): boolean {
    if (!process.stdout.isTTY || !process.stdin.isTTY) {
      return false;
    }

    this.enabled = true;
    this.anchored = false;
    this.previousFrame = null;
    this.viewportTopRow = 1;

    this.resizeHandler = () => {
      this.render();
    };
    process.stdout.on("resize", this.resizeHandler);
    return true;
  }

  async anchorFromCursor(): Promise<void> {
    const row = await this.terminalInput?.requestCursorRow();
    if (row !== null && row > 0) {
      this.anchorRow = row;
    } else {
      // Fall back to a compact inline start near the bottom when cursor probing fails.
      this.anchorRow = getTerminalRows();
    }
    this.viewportTopRow = this.anchorRow;
    this.anchored = true;
    this.render();
  }

  isAnchored(): boolean {
    return this.anchored;
  }

  beginMessage(kind: MessageKind): void {
    this.messages.beginMessage(kind);
  }

  endMessage(): void {
    this.messages.sealMessage();
  }

  getLastOutputLine(): number {
    return this.messages.totalLines(getTerminalColumns());
  }

  reset(): void {
    if (this.resizeHandler) {
      process.stdout.off("resize", this.resizeHandler);
      this.resizeHandler = null;
    }

    if (!this.enabled) {
      return;
    }

    process.stdout.write("\x1b[r");
    process.stdout.write("\x1b[?25h");
    this.enabled = false;
    this.anchored = false;
    this.anchorRow = 1;
    this.viewportTopRow = 1;
    this.historyOffset = 0;
    this.followOutput = true;
    this.contentWindowRows = 1;
    this.messages.clear();
    this.streamBuffer = "";
    this.statusLine = null;
    this.inputLines = [plainLine("")];
    this.previousFrame = null;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setDebugOverlay(enabled: boolean): void {
    this.debugOverlay = enabled;
    this.render();
  }

  isDebugOverlayEnabled(): boolean {
    return this.debugOverlay;
  }

  setBottomLines(lines: Array<StyledLine | string>): void {
    this.setReservedRows(lines.length, lines);
  }

  setReservedRows(rows: number, lines: Array<StyledLine | string>): void {
    this.reservedRows = Math.max(1, rows);
    this.inputLines = (lines.length > 0 ? lines : [plainLine("")]).map((line) =>
      normalizeStyledLine(line),
    );
    this.render();
  }

  beginStream(): void {
    this.streamBuffer = "";
    this.statusLine = null;
    if (this.followOutput) {
      this.historyOffset = 0;
    }
    this.render();
  }

  endStream(): void {
    // When a streamed assistant reply becomes a sealed transcript message, we
    // keep one extra wrapped blank row above it so the final reply breathes a
    // bit more than the in-progress stream state.
    if (this.streamBuffer && this.messages.messageCount > 0) {
      this.streamBuffer = `\n${this.streamBuffer}`;
    }
    this.flushStreamBuffer();
    this.statusLine = null;
    if (this.followOutput) {
      this.historyOffset = 0;
    }
    this.render();
  }

  writeStatusLine(text: StyledLine | string): void {
    if (!this.enabled || !this.anchored) {
      process.stdout.write(`\r\x1b[K${styledLineText(normalizeStyledLine(text))}`);
      return;
    }

    this.statusLine = normalizeStyledLine(text);
    this.render();
  }

  clearStatusLine(): void {
    this.statusLine = null;
    this.render();
  }

  writelnBelowStatus(text: StyledLine | string): void {
    this.writelnScroll(text);
  }

  hasStatusLine(): boolean {
    return this.statusLine !== null;
  }

  writeScroll(text: StyledLine | string): void {
    const line = normalizeStyledLine(text);
    const plain = styledLineText(line);

    if (!this.enabled || !this.anchored) {
      process.stdout.write(plain);
      return;
    }

    this.streamBuffer += plain;
    if (this.followOutput) {
      this.historyOffset = 0;
    }
    this.render();
  }

  writelnScroll(text: StyledLine | string): void {
    const line = normalizeStyledLine(text);
    const plain = styledLineText(line);

    if (!this.enabled || !this.anchored) {
      process.stdout.write(`${plain}\n`);
      return;
    }

    this.flushStreamBuffer();
    this.messages.appendLine(plain);
    if (this.followOutput) {
      this.historyOffset = 0;
    }
    this.render();
  }

  writelnIntro(text: string): void {
    process.stdout.write(`${text}\n`);
  }

  scrollPage(deltaPages: number): void {
    if (!this.enabled || !this.anchored) {
      return;
    }

    const step = Math.max(1, this.contentWindowRows - 1);
    this.historyOffset += deltaPages * step;
    this.followOutput = false;
    this.render();
  }

  scrollLines(deltaLines: number): void {
    if (!this.enabled || !this.anchored) {
      return;
    }

    if (deltaLines === 0) {
      return;
    }

    this.historyOffset += deltaLines;
    this.followOutput = false;
    this.render();
  }

  scrollToLatest(): void {
    if (!this.enabled || !this.anchored) {
      return;
    }

    this.historyOffset = 0;
    this.followOutput = true;
    this.render();
  }

  private flushStreamBuffer(): void {
    if (!this.streamBuffer) {
      return;
    }

    this.messages.appendLine(this.streamBuffer);
    this.streamBuffer = "";
  }

  private streamLines(): StyledLine[] {
    if (!this.streamBuffer) {
      return [];
    }

    const lines = wrapPaddedTranscriptLines(this.streamBuffer, getTerminalColumns()).map((line) =>
      plainLine(line),
    );
    return this.messages.messageCount > 0 ? [plainLine(""), ...lines] : lines;
  }

  private render(): void {
    if (!this.enabled || !this.anchored) {
      return;
    }

    const rows = getTerminalRows();
    const cols = getTerminalColumns();
    const GAP_ROWS = 1;
    const transcriptCount = this.messages.totalLines(cols);
    const streamContent = this.streamLines();
    const fullLength = transcriptCount + streamContent.length;
    const statusLeadingGapRows = this.statusLine && fullLength > 0 ? 1 : 0;
    const statusRows = this.statusLine ? statusLeadingGapRows + 1 : 0;
    const debugRows = this.debugOverlay ? 1 : 0;
    const neededRows = Math.max(1, fullLength + statusRows + GAP_ROWS + this.reservedRows + debugRows);
    const anchor = Math.min(rows, Math.max(1, this.anchorRow));
    const initialViewportRows = Math.max(1, rows - anchor + 1);
    const targetViewportRows = Math.min(rows, Math.max(initialViewportRows, neededRows));
    const desiredTop = Math.max(1, rows - targetViewportRows + 1);
    // Keep viewport growth monotonic within a session: once grown upward, do not shrink down.
    this.viewportTopRow = Math.max(1, Math.min(anchor, this.viewportTopRow, desiredTop));
    const viewportTop = this.viewportTopRow;
    const viewportRows = Math.max(1, rows - viewportTop + 1);
    const visibleInputRows = getVisiblePinnedInputRows(this.reservedRows, viewportRows);
    const visibleInput = this.inputLines.slice(-visibleInputRows);
    const pinned = fullLength + statusRows + GAP_ROWS + debugRows + visibleInput.length > viewportRows;
    const contentCapacity = pinned
      ? Math.max(0, viewportRows - visibleInput.length - statusRows - GAP_ROWS - debugRows)
      : fullLength;
    this.contentWindowRows = Math.max(1, contentCapacity);
    const maxOffset = Math.max(0, fullLength - contentCapacity);
    this.historyOffset = Math.max(0, Math.min(maxOffset, this.historyOffset));
    if (this.historyOffset === 0) {
      this.followOutput = true;
    }
    const endExclusive = Math.max(0, fullLength - this.historyOffset);
    const startInclusive = Math.max(0, endExclusive - contentCapacity);
    const visibleTranscript = this.messages.getLines(startInclusive, Math.min(endExclusive, transcriptCount), cols);
    const streamStart = Math.max(0, startInclusive - transcriptCount);
    const streamEnd = Math.max(0, Math.min(endExclusive - transcriptCount, streamContent.length));
    const visibleStream = streamContent.slice(streamStart, streamEnd);
    const visibleContent = [...visibleTranscript, ...visibleStream];

    const lines: StyledLine[] = Array.from({ length: viewportRows }, () => plainLine(""));
    let row = 0;

    if (this.debugOverlay && viewportRows > 0) {
      const debugText =
        `dbg a:${anchor} top:${viewportTop} vr:${viewportRows} ` +
        `cap:${contentCapacity} full:${fullLength} off:${this.historyOffset} ` +
        `msgs:${this.messages.messageCount} ` +
        `follow:${this.followOutput ? "1" : "0"} pin:${pinned ? "1" : "0"} dtop:${desiredTop} ` +
        `sr:${viewportTop}-${pinned ? Math.max(viewportTop, rows - visibleInput.length) : rows}`;
      lines[0] = styledLine(debugText.slice(0, Math.max(1, cols)), { dim: true, color: "yellow" });
      row = 1;
    }

    for (const line of visibleContent.slice(-viewportRows)) {
      if (row >= viewportRows) break;
      lines[row] = line;
      row += 1;
    }

    if (this.statusLine) {
      const statusRow = pinned
        ? Math.max(0, viewportRows - visibleInput.length - 1 - GAP_ROWS)
        : Math.min(viewportRows - 1, row + statusLeadingGapRows);
      lines[statusRow] = this.statusLine;
    }

    const inputStart = pinned
      ? Math.max(0, viewportRows - visibleInput.length)
      : Math.min(viewportRows - visibleInput.length, row + statusRows + GAP_ROWS);
    for (let index = 0; index < visibleInput.length; index += 1) {
      lines[inputStart + index] = visibleInput[index] ?? plainLine("");
    }

    const cursorLine = visibleInput[visibleInput.length - 1] ?? plainLine("");
    const cursorRow = viewportTop + Math.max(1, inputStart + visibleInput.length) - 1;
    const scrollBottom = pinned
      ? Math.max(viewportTop, rows - visibleInput.length - GAP_ROWS)
      : rows;
    const frame = clampFrameCursor(
      {
        lines,
        topRow: viewportTop,
        scrollTop: viewportTop,
        scrollBottom,
        cursor: {
          row: cursorRow,
          col: cursorColFromLine(cursorLine, cols),
          visible: false,
        },
      },
      rows,
      cols,
    );
    const operations = diffFrames(this.previousFrame, frame);
    const output = serializeDiffOps(operations);

    if (output) {
      process.stdout.write(output);
    }

    this.previousFrame = frame;
  }

}
