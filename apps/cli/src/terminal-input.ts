const CURSOR_POSITION_REPORT = /^\x1b\[(\d+);(\d+)R$/;
const MOUSE_EVENT_REPORT = /^\x1b\[<\d+;\d+;\d+[mM]$/;

export function isTerminalResponse(chunk: string): boolean {
  if (CURSOR_POSITION_REPORT.test(chunk)) {
    return true;
  }

  if (MOUSE_EVENT_REPORT.test(chunk)) {
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
        /^\x1b(?:\[[0-9;]*[A-Za-z]|\[<\d+;\d+;\d+[mM]|\][^\x07]*(?:\x07|\x1b\\)|[OPINOZ=><\^]|\([AB012])/,
      );

      if (!match) {
        break;
      }

      const sequence = match[0];

      if (!isTerminalResponse(sequence)) {
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

  start(): void {
    if (this.active) {
      return;
    }

    this.active = true;
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

    process.stdout.write(enabled ? "\x1b[?1000h\x1b[?1006h" : "\x1b[?1000l\x1b[?1006l");
  }

  async requestCursorRow(timeoutMs = 750): Promise<number | null> {
    if (!this.active || !process.stdin.isTTY || !process.stdout.isTTY) {
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

    const cursorMatch = this.pending.match(/\x1b\[(\d+);(\d+)R/);

    if (cursorMatch) {
      const row = Number(cursorMatch[1]);

      for (const waiter of this.cursorWaiters) {
        waiter(row);
      }

      this.cursorWaiters.clear();
      this.pending = this.pending.replace(/\x1b\[\d+;\d+R/g, "");
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
