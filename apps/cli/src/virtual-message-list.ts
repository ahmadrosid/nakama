import { plainLine, type StyledLine } from "./styled-text";
import { wrapText } from "./text-measure";

export type MessageKind = "user" | "output" | "assistant";

export interface VirtualMessage {
  text: string;
  kind: MessageKind;
}

/**
 * Manages transcript messages and provides line-level access with lazy
 * wrapping. Only messages that overlap the requested line range get their
 * content computed, keeping render cost proportional to viewport size rather
 * than total conversation length.
 *
 * Offsets are maintained incrementally — appending a new message only wraps
 * that one message, not the entire history. A terminal width change forces a
 * full recompute but that happens infrequently.
 *
 * Two usage modes:
 * 1. **Explicit message boundaries** via beginMessage/endMessage — multiple
 *    appendLine calls group into a single multi-line message.
 * 2. **Implicit single-line messages** — calling appendLine without
 *    beginMessage creates a one-line message per call.
 */
export class VirtualMessageList {
  private messages: VirtualMessage[] = [];
  private currentText: string[] = [];
  private currentKind: MessageKind = "user";
  private hasOpenMessage = false;

  // Cached line offsets at cachedWidth: offsets[i] = starting line of msg i.
  // Guarantee: offsets.length === messages.length + 1 when fully computed.
  private cachedWidth = 0;
  private offsets: number[] = [0];
  private wrappedCache = new Map<number, string[]>();

  // ── Mutation ──────────────────────────────────────────────────────

  /** Start accumulating lines for a new multi-line message. */
  beginMessage(kind: MessageKind): void {
    this.sealMessage();
    this.currentKind = kind;
    this.hasOpenMessage = true;
  }

  /**
   * Add text to the current message.
   *
   * If beginMessage was called, the text accumulates into the open message.
   * Otherwise, each call creates an individual single-line message, which is
   * the expected behaviour when writelnScroll is called without explicit
   * message boundaries (e.g. from tests).
   */
  appendLine(text: string): void {
    if (this.hasOpenMessage) {
      this.currentText.push(text);
      return;
    }

    // Implicit single-line message
    this.messages.push({ text, kind: this.currentKind });
    this.invalidateOffsets();
  }

  /** Finalize the current multi-line message, if any. */
  sealMessage(): void {
    if (!this.hasOpenMessage || this.currentText.length === 0) return;
    this.messages.push({
      text: this.currentText.join("\n"),
      kind: this.currentKind,
    });
    this.currentText = [];
    this.hasOpenMessage = false;
    this.invalidateOffsets();
  }

  clear(): void {
    this.messages = [];
    this.currentText = [];
    this.currentKind = "user";
    this.hasOpenMessage = false;
    this.cachedWidth = 0;
    this.offsets = [0];
    this.wrappedCache.clear();
  }

  get messageCount(): number {
    return this.messages.length;
  }

  // ── Internal offset management ────────────────────────────────────

  private invalidateOffsets(): void {
    // Keep offsets up to the last known message count so incremental
    // recompute can pick up from there.
    if (this.offsets.length > this.messages.length + 1) {
      this.offsets = this.offsets.slice(0, this.messages.length);
    }
  }

  /**
   * Ensure offsets and wrapped lines are up to date for `width`.
   * Only newly-added messages are computed; previously-cached results are
   * reused. A width change forces a full rewrap.
   */
  private ensureWidth(width: number): void {
    if (width === this.cachedWidth && this.offsets.length === this.messages.length + 1) {
      return; // fully up to date
    }

    if (width !== this.cachedWidth) {
      this.cachedWidth = width;
      this.offsets = [0];
      this.wrappedCache.clear();
    }

    // Ensure we have at least the base offset
    if (this.offsets.length === 0) {
      this.offsets = [0];
    }

    // Incrementally compute offsets for uncached messages
    const startFrom = Math.max(0, this.offsets.length - 1);
    for (let i = startFrom; i < this.messages.length; i++) {
      let lines = this.wrappedCache.get(i);
      if (!lines) {
        lines = wrapText(this.messages[i].text, width);
        this.wrappedCache.set(i, lines);
      }
      this.offsets.push(this.offsets[this.offsets.length - 1] + lines.length);
    }
  }

  // ── Line resolution (lazy) ────────────────────────────────────────

  /** Total number of wrapped lines at the given width. */
  totalLines(width: number): number {
    this.ensureWidth(width);
    return this.offsets[this.messages.length];
  }

  /**
   * Return the wrapped lines in the range [start, end) at the given width.
   * Only messages that overlap the range are actually wrapped — the rest
   * are skipped.
   */
  getLines(start: number, end: number, width: number): StyledLine[] {
    this.ensureWidth(width);
    const result: StyledLine[] = [];

    for (let i = 0; i < this.messages.length; i++) {
      const msgStart = this.offsets[i];
      const msgEnd = this.offsets[i + 1];

      if (msgEnd <= start) continue;
      if (msgStart >= end) break;

      let lines = this.wrappedCache.get(i);
      if (!lines) {
        lines = wrapText(this.messages[i].text, width);
        this.wrappedCache.set(i, lines);
      }

      const localStart = Math.max(0, start - msgStart);
      const localEnd = Math.min(lines.length, end - msgStart);
      for (let j = localStart; j < localEnd; j++) {
        result.push(plainLine(lines[j]));
      }
    }

    return result;
  }

  // ── Navigation helpers ────────────────────────────────────────────

  /**
   * Return the line offset of the nearest message boundary relative to
   * `currentLine`.
   *
   * - direction "up": snap to the start of the current message (or previous
   *   message if already at the start of the current).
   * - direction "down": snap to the start of the next message.
   */
  snapToMessage(currentLine: number, direction: "up" | "down", width: number): number {
    this.ensureWidth(width);
    const count = this.messages.length;
    if (count === 0) return currentLine;

    for (let i = 0; i < count; i++) {
      const msgStart = this.offsets[i];
      const msgEnd = this.offsets[i + 1];

      if (currentLine < msgStart || currentLine >= msgEnd) continue;

      if (direction === "up") {
        if (currentLine - msgStart > 0) return msgStart;
        if (i > 0) return this.offsets[i - 1];
        return msgStart;
      }

      if (i + 1 < count) return this.offsets[i + 1];
      return msgEnd - 1;
    }

    return currentLine;
  }

  /** Return the message index and local line offset for a given global line. */
  messageAtLine(line: number, width: number): { index: number; lineOffset: number } | null {
    this.ensureWidth(width);
    for (let i = 0; i < this.messages.length; i++) {
      const msgStart = this.offsets[i];
      const msgEnd = this.offsets[i + 1];
      if (line >= msgStart && line < msgEnd) {
        return { index: i, lineOffset: line - msgStart };
      }
    }
    return null;
  }

  /** The wrapped line content for a single message (cached). */
  messageLines(index: number, width: number): string[] {
    this.ensureWidth(width);
    const cached = this.wrappedCache.get(index);
    if (cached) return cached;
    const lines = wrapText(this.messages[index].text, width);
    this.wrappedCache.set(index, lines);
    return lines;
  }
}
