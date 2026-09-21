import {
  type Component,
  CURSOR_MARKER,
  ProcessTerminal,
  TuiMainScreen,
} from "@earendil-works/pi-tui";
import {
  normalizeStyledLine,
  plainLine,
  type StyledLine,
  serializeStyledLine,
  styledLine,
  styledLineText,
} from "./styled-text";
import type { TerminalInput } from "./terminal-input";
import { stripAnsi } from "./text-measure";
import type { MessageKind } from "./virtual-message-list";
import {
  renderMarkdownLines,
  VirtualMessageList,
} from "./virtual-message-list";

interface FrameModel {
  lines: StyledLine[];
  topRow: number;
}

class FrameComponent implements Component {
  constructor(private lines: string[] = []) {}

  render(): string[] {
    return this.lines;
  }

  invalidate(): void {}

  setLines(lines: string[]): void {
    this.lines = lines;
  }
}

export function getVisiblePinnedInputRows(
  inputRows: number,
  terminalRows: number
): number {
  const rows = Math.max(1, inputRows);
  const maxVisibleRows = terminalRows > 1 ? terminalRows - 1 : 1;
  return Math.min(rows, maxVisibleRows);
}

export function getTerminalRows(): number {
  return process.stdout.rows ?? 24;
}

export function getTerminalColumns(): number {
  return process.stdout.columns ?? 80;
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
  previousFrame: FrameModel | null = null;
  private readonly frameComponent = new FrameComponent();
  private readonly tui = new TuiMainScreen(new ProcessTerminal());
  private hasPainted = false;
  private historyOffset = 0;
  private followOutput = true;
  private debugOverlay = false;
  private contentWindowRows = 1;
  private resizeHandler: (() => void) | null = null;

  constructor(private readonly terminalInput: TerminalInput | null = null) {
    this.tui.addChild(this.frameComponent);
  }

  apply(): boolean {
    if (!(process.stdout.isTTY && process.stdin.isTTY)) {
      return false;
    }

    this.enabled = true;
    this.anchored = false;
    this.previousFrame = null;
    this.viewportTopRow = 1;
    this.hasPainted = false;

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
    this.flushStreamBuffer();
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
    this.frameComponent.setLines([]);
    this.tui.resetRenderState();
    this.hasPainted = false;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  clear(): void {
    this.messages.clear();
    this.streamBuffer = "";
    this.statusLine = null;
    this.historyOffset = 0;
    this.followOutput = true;
    this.anchorRow = 1;
    this.viewportTopRow = 1;
    this.previousFrame = null;
    this.tui.resetRenderState();
    this.hasPainted = false;
    if (this.enabled) {
      process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
    }
    this.render();
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
      normalizeStyledLine(line)
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
    if (!(this.enabled && this.anchored)) {
      process.stdout.write(
        `\r\x1b[K${styledLineText(normalizeStyledLine(text))}`
      );
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

    if (!(this.enabled && this.anchored)) {
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

    if (!(this.enabled && this.anchored)) {
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
    process.stdout.write(`${stripAnsi(text)}\n`);
  }

  scrollPage(deltaPages: number): void {
    if (!(this.enabled && this.anchored)) {
      return;
    }

    const step = Math.max(1, this.contentWindowRows - 1);
    this.historyOffset += deltaPages * step;
    this.followOutput = false;
    this.render();
  }

  scrollLines(deltaLines: number): void {
    if (!(this.enabled && this.anchored)) {
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
    if (!(this.enabled && this.anchored)) {
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

    this.messages.beginMessage("assistant");
    this.messages.appendLine(this.streamBuffer);
    this.messages.sealMessage();
    this.streamBuffer = "";
  }

  private streamLines(): StyledLine[] {
    if (!this.streamBuffer) {
      return [];
    }

    const lines = renderMarkdownLines(this.streamBuffer, getTerminalColumns());
    return this.messages.messageCount > 0 ? [plainLine(""), ...lines] : lines;
  }

  private render(): void {
    if (!(this.enabled && this.anchored)) {
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
    const neededRows = Math.max(
      1,
      fullLength + statusRows + GAP_ROWS + this.reservedRows + debugRows
    );
    const anchor = Math.min(rows, Math.max(1, this.anchorRow));
    const initialViewportRows = Math.max(1, rows - anchor + 1);
    const targetViewportRows = Math.min(
      rows,
      Math.max(initialViewportRows, neededRows)
    );
    const desiredTop = Math.max(1, rows - targetViewportRows + 1);
    // Keep viewport growth monotonic within a session: once grown upward, do not shrink down.
    this.viewportTopRow = Math.max(
      1,
      Math.min(anchor, this.viewportTopRow, desiredTop)
    );
    const viewportTop = this.viewportTopRow;
    const viewportRows = Math.max(1, rows - viewportTop + 1);
    const visibleInputRows = getVisiblePinnedInputRows(
      this.reservedRows,
      viewportRows
    );
    const visibleInput = this.inputLines.slice(-visibleInputRows);
    const pinned =
      fullLength + statusRows + GAP_ROWS + debugRows + visibleInput.length >
      viewportRows;
    const contentCapacity = pinned
      ? Math.max(
          0,
          viewportRows - visibleInput.length - statusRows - GAP_ROWS - debugRows
        )
      : fullLength;
    this.contentWindowRows = Math.max(1, contentCapacity);
    const maxOffset = Math.max(0, fullLength - contentCapacity);
    this.historyOffset = Math.max(0, Math.min(maxOffset, this.historyOffset));
    if (this.historyOffset === 0) {
      this.followOutput = true;
    }
    const endExclusive = Math.max(0, fullLength - this.historyOffset);
    const startInclusive = Math.max(0, endExclusive - contentCapacity);
    const visibleTranscript = this.messages.getLines(
      startInclusive,
      Math.min(endExclusive, transcriptCount),
      cols
    );
    const streamStart = Math.max(0, startInclusive - transcriptCount);
    const streamEnd = Math.max(
      0,
      Math.min(endExclusive - transcriptCount, streamContent.length)
    );
    const visibleStream = streamContent.slice(streamStart, streamEnd);
    const visibleContent = [...visibleTranscript, ...visibleStream];

    const lines: StyledLine[] = Array.from({ length: viewportRows }, () =>
      plainLine("")
    );
    let row = 0;

    if (this.debugOverlay && viewportRows > 0) {
      const debugText =
        `dbg a:${anchor} top:${viewportTop} vr:${viewportRows} ` +
        `cap:${contentCapacity} full:${fullLength} off:${this.historyOffset} ` +
        `msgs:${this.messages.messageCount} ` +
        `follow:${this.followOutput ? "1" : "0"} pin:${pinned ? "1" : "0"} dtop:${desiredTop} ` +
        `sr:${viewportTop}-${pinned ? Math.max(viewportTop, rows - visibleInput.length) : rows}`;
      lines[0] = styledLine(debugText.slice(0, Math.max(1, cols)), {
        color: "yellow",
        dim: true,
      });
      row = 1;
    }

    for (const line of visibleContent.slice(-viewportRows)) {
      if (row >= viewportRows) {
        break;
      }
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
      : Math.min(
          viewportRows - visibleInput.length,
          row + statusRows + GAP_ROWS
        );
    for (let index = 0; index < visibleInput.length; index += 1) {
      lines[inputStart + index] = visibleInput[index] ?? plainLine("");
    }

    const frame = {
      lines,
      topRow: viewportTop,
    };
    this.previousFrame = frame;
    const renderedLines = lines.map(serializeStyledLine);
    const cursorLine = inputStart + visibleInput.length - 2;
    if (cursorLine >= 0 && cursorLine < renderedLines.length) {
      const cursorText = styledLineText(lines[cursorLine]).trimEnd();
      const cursorTextStart = renderedLines[cursorLine]?.indexOf(cursorText);
      if (cursorTextStart !== undefined && cursorTextStart >= 0) {
        const cursorEnd = cursorTextStart + cursorText.length;
        renderedLines[cursorLine] =
          renderedLines[cursorLine].slice(0, cursorEnd) +
          CURSOR_MARKER +
          renderedLines[cursorLine].slice(cursorEnd);
      }
    }
    this.frameComponent.setLines(renderedLines);
    if (!this.hasPainted) {
      this.tui.terminal.write(`\x1b[${viewportTop};1H`);
      this.hasPainted = true;
    }
    this.tui.renderNow();
  }
}
