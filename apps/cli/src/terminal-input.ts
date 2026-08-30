const CURSOR_POSITION_REPORT = /^\x1b\[(\d+);(\d+)R$/;
const CURSOR_POSITION_REPORT_GLOBAL = /\x1b\[(\d+);(\d+)R/g;
const MOUSE_EVENT_REPORT = /^\x1b\[<\d+;\d+;\d+[mM]$/;

type ReadableEncodingState = {
  decoder?: unknown;
  encoding?: string | null;
};

/**
 * Restore a Readable stream's prior encoding.
 * `setEncoding(null)` does not clear encoding in Node/Bun (nodejs/node#51083),
 * so buffer mode is restored by clearing `_readableState` when needed.
 */
export function restoreReadableEncoding(
  stream: NodeJS.ReadableStream,
  previous: BufferEncoding | null | undefined
): void {
  if (previous) {
    stream.setEncoding(previous);
    return;
  }

  const state = (stream as { _readableState?: ReadableEncodingState })
    ._readableState;
  if (!state) {
    return;
  }

  state.encoding = null;
  state.decoder = null;
}

/** Strip all CPR sequences in one pass; return the first report's row. */
export function stripCursorPositionReports(pending: string): {
  pending: string;
  row: number | null;
} {
  let row: number | null = null;
  const cleaned = pending.replace(
    CURSOR_POSITION_REPORT_GLOBAL,
    (_match, rowText: string) => {
      if (row === null) {
        row = Number(rowText);
      }
      return "";
    }
  );
  return { pending: cleaned, row };
}

export function isTerminalResponse(chunk: string): boolean {
  if (CURSOR_POSITION_REPORT.test(chunk)) {
    return true;
  }

  if (chunk === "\x1b[I" || chunk === "\x1b[O") {
    return true;
  }

  if (/^\x1b\[\?\d+;\d+\$y$/.test(chunk)) {
    return true;
  }

  return false;
}

export function isMouseEventReport(chunk: string): boolean {
  return MOUSE_EVENT_REPORT.test(chunk);
}

/** True when more bytes may still complete a valid ESC sequence. */
export function isIncompleteEscapeSequence(pending: string): boolean {
  if (pending === "\x1b" || pending === "\x1b[" || pending === "\x1b(") {
    return true;
  }

  if (/^\x1b\[[0-9;]*$/.test(pending)) {
    return true;
  }

  if (/^\x1b\[<\d*(?:;\d*){0,2}$/.test(pending)) {
    return true;
  }

  if (pending.startsWith("\x1b]") && !/(?:\x07|\x1b\\)$/.test(pending)) {
    return true;
  }

  return false;
}

export function consumeTerminalInput(buffer: string): {
  events: string[];
  pending: string;
} {
  const events: string[] = [];
  let pending = buffer;

  while (pending.length > 0) {
    if (pending.startsWith("\x1b[200~")) {
      const end = pending.indexOf("\x1b[201~");

      if (end < 0) {
        break;
      }

      events.push(pending.slice(0, end + "\x1b[201~".length));
      pending = pending.slice(end + "\x1b[201~".length);
      continue;
    }

    if (pending.startsWith("\x1b")) {
      const match = pending.match(
        /^\x1b(?:\[[0-9;]*[A-Za-z]|\[<\d+;\d+;\d+[mM]|\][^\x07]*(?:\x07|\x1b\\)|[OPINOZ=><^]|\([AB012])/
      );

      if (!match) {
        if (isIncompleteEscapeSequence(pending)) {
          break;
        }

        // Malformed ESC: emit bare ESC so pending can drain.
        events.push("\x1b");
        pending = pending.slice(1);
        continue;
      }

      const sequence = match[0];

      if (isMouseEventReport(sequence)) {
        events.push(sequence);
      } else if (!isTerminalResponse(sequence)) {
        events.push(sequence);
      }

      pending = pending.slice(sequence.length);
      continue;
    }

    events.push(pending[0] ?? "");
    pending = pending.slice(1);
  }

  return { events, pending };
}

export class TerminalInput {
  private active = false;
  private mouseTracking = false;
  private pending = "";
  private listeners = new Set<(chunk: string) => void>();
  private cursorWaiters = new Set<(row: number) => void>();
  private previousEncoding: BufferEncoding | null | undefined;

  start(): void {
    if (this.active) {
      return;
    }

    this.active = true;
    this.previousEncoding = process.stdin.readableEncoding;
    process.stdin.setEncoding("utf8");
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", this.handleData);
    process.stdout.write("\x1b[?2004h");

    if (this.mouseTracking) {
      process.stdout.write("\x1b[?1000h\x1b[?1006h");
    }
  }

  stop(): void {
    if (!this.active) {
      return;
    }

    this.active = false;
    process.stdin.off("data", this.handleData);
    process.stdin.setRawMode(false);
    restoreReadableEncoding(process.stdin, this.previousEncoding);
    this.previousEncoding = undefined;

    if (this.mouseTracking) {
      process.stdout.write("\x1b[?1000l\x1b[?1006l");
      this.mouseTracking = false;
    }

    process.stdout.write("\x1b[?2004l");
    this.listeners.clear();
    this.cursorWaiters.clear();
    this.pending = "";
  }

  isActive(): boolean {
    return this.active;
  }

  onInput(listener: (chunk: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setMouseTracking(enabled: boolean): void {
    if (this.mouseTracking === enabled) {
      return;
    }

    this.mouseTracking = enabled;

    if (!this.active) {
      return;
    }

    process.stdout.write(
      enabled ? "\x1b[?1000h\x1b[?1006h" : "\x1b[?1000l\x1b[?1006l"
    );
  }

  async requestCursorRow(timeoutMs = 750): Promise<number | null> {
    if (!(this.active && process.stdin.isTTY && process.stdout.isTTY)) {
      return null;
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.cursorWaiters.delete(onCursor);
        resolve(null);
      }, timeoutMs);

      const onCursor = (row: number) => {
        clearTimeout(timeout);
        this.cursorWaiters.delete(onCursor);
        resolve(row);
      };

      this.cursorWaiters.add(onCursor);
      process.stdout.write("\x1b[6n");
    });
  }

  private handleData = (chunk: Buffer | string): void => {
    this.pending += String(chunk);

    const stripped = stripCursorPositionReports(this.pending);
    this.pending = stripped.pending;

    if (stripped.row !== null) {
      for (const waiter of this.cursorWaiters) {
        waiter(stripped.row);
      }
      this.cursorWaiters.clear();
    }

    const consumed = consumeTerminalInput(this.pending);
    this.pending = consumed.pending;

    for (const event of consumed.events) {
      for (const listener of this.listeners) {
        listener(event);
      }
    }
  };
}
